'use strict';
/**
 * SYNTRA 2.0 — ml-scorer
 *
 * Combina tres fuentes de score (0-100 cada una):
 *   55% — SageMaker XGBoost+LSTM (Fase 3: fallback Stoch quality mientras no listo)
 *   25% — Bedrock claude-sonnet-4-5 (contexto cualitativo — implementado aquí)
 *   20% — Historial personal DynamoDB (win rate del índice del usuario)
 *
 * Score final >= 65 → señal enviada
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { SageMakerRuntimeClient, InvokeEndpointCommand } = require('@aws-sdk/client-sagemaker-runtime');
const { SageMakerClient, DescribeEndpointCommand } = require('@aws-sdk/client-sagemaker');
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const bedrock    = new BedrockRuntimeClient({ region: 'us-east-1' });
const smRuntime  = new SageMakerRuntimeClient({ region: 'us-east-1' });
const smClient   = new SageMakerClient({ region: 'us-east-1' });
const dynamo     = new DynamoDBClient({ region: 'us-east-1' });

const TRADES_TABLE   = process.env.DYNAMODB_TABLE_TRADES || 'syntra-trades';
const BEDROCK_MODEL  = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';
const SCORE_WEIGHTS  = { sagemaker: 0.70, bedrock: 0.30 };

// Cache endpoint status to avoid DescribeEndpoint on every call (60s TTL)
const endpointStatusCache = new Map(); // symbol → { status, ts }

// ── 1. SageMaker endpoint invocation ─────────────────────────────────────────

/**
 * Devuelve el nombre del endpoint para un símbolo.
 * Pattern: syntra-{symbol-lowercase-sin-N}-endpoint
 */
function endpointName(symbol) {
  return `syntra-${symbol.toLowerCase().replace(/n$/, '')}-endpoint`;
}

/**
 * Verifica si el endpoint está InService (con caché 60s).
 */
async function isEndpointInService(symbol) {
  const cached = endpointStatusCache.get(symbol);
  if (cached && Date.now() - cached.ts < 60_000) return cached.status === 'InService';

  try {
    const resp = await smClient.send(new DescribeEndpointCommand({
      EndpointName: endpointName(symbol),
    }));
    const status = resp.EndpointStatus;
    endpointStatusCache.set(symbol, { status, ts: Date.now() });
    return status === 'InService';
  } catch {
    endpointStatusCache.set(symbol, { status: 'NotFound', ts: Date.now() });
    return false;
  }
}

/**
 * Construye el CSV row que espera el contenedor XGBoost de SageMaker.
 * Feature order must match FEATURE_COLS from syntra-tick-etl.py (v2).
 * 24 features: 3 TF stoch (4 each) + alignment + trend + temporal + zone + hooks
 */
const FEATURE_COLS = [
  'stoch_1h_k',  'stoch_1h_d',  'stoch_1h_kd_diff',  'stoch_1h_d_slope',
  'stoch_15m_k', 'stoch_15m_d', 'stoch_15m_kd_diff', 'stoch_15m_d_slope',
  'stoch_5m_k',  'stoch_5m_d',  'stoch_5m_kd_diff',  'stoch_5m_d_slope',
  'tf_alignment', 'trend_confirmed',
  'lh_magnitude', 'hl_magnitude',
  'hour_of_day', 'day_of_week',
  'zone_distance_pct', 'price_in_zone',
  'candles_since_swing', 'momentum_5m',
  'stoch_1h_hook', 'stoch_15m_hook',
];

function featuresToCsv(features) {
  return FEATURE_COLS.map(col => {
    const v = features[col];
    return v != null && !isNaN(v) ? v : 0;
  }).join(',');
}

/**
 * Llama al endpoint SageMaker XGBoost y retorna score 0-100.
 * El modelo predice probabilidad de spike_in_next_50t (0-1).
 * Retorna null si el endpoint no está InService o hay error.
 */
async function getSageMakerScore(features, symbol) {
  try {
    const inService = await isEndpointInService(symbol);
    if (!inService) return null;

    const csvRow = featuresToCsv(features);
    const resp = await smRuntime.send(new InvokeEndpointCommand({
      EndpointName: endpointName(symbol),
      ContentType: 'text/csv',
      Accept: 'text/csv',
      Body: Buffer.from(csvRow),
    }));

    const body = Buffer.from(resp.Body).toString().trim();
    const prob = parseFloat(body);

    if (isNaN(prob) || prob < 0 || prob > 1) {
      throw new Error(`Invalid SageMaker response: ${body}`);
    }

    // Convert probability to 0-100 score
    return Math.round(prob * 100);
  } catch (e) {
    console.log(JSON.stringify({ action: 'sagemakerScoreWarn', symbol, error: e.message }));
    return null;
  }
}

// ── 1b. SageMaker fallback (cuando endpoint no está InService) ────────────────

/**
 * Stochastic quality score — fallback hasta que SageMaker está entrenado.
 * Penaliza si K y D están muy cerca del umbral (señal débil) o demasiado
 * lejos (posible reversión). Premia divergencia y pendiente sostenida.
 */
function sagemakerFallback(features, indexType) {
  let score = 50;
  const isCrash = indexType === 'crash';

  // Tendencia confirmada (LH+LL o HH+HL) — filtro más importante
  if (features.trend_confirmed === 1) score += 15;
  else score -= 15;

  // Hook K cruza D — confirmación de reversión
  if (features.stoch_1h_hook === 1)  score += 15;
  if (features.stoch_15m_hook === 1) score += 8;

  // Alineación de temporalidades (0-3)
  const tf_alignment = features.tf_alignment ?? 0;
  score += tf_alignment * 5; // hasta +15 si las 3 TF están en zona

  // Fortaleza de la señal en 1H (K y D bien separados = mayor convicción)
  const kd_diff_1h = Math.abs(features.stoch_1h_kd_diff ?? 0);
  if (kd_diff_1h > 5)      score += 10;
  else if (kd_diff_1h > 2) score += 5;
  else                      score -= 5;

  // Confirmación 15M
  const kd_diff_15m = Math.abs(features.stoch_15m_kd_diff ?? 0);
  if (kd_diff_15m > 3) score += 8;
  else if (kd_diff_15m > 1) score += 4;

  // Magnitud de la tendencia (fuerza del movimiento entre swings)
  const trend_strength = isCrash
    ? (features.lh_magnitude ?? 0)
    : (features.hl_magnitude ?? 0);
  if (trend_strength > 0.5) score += 8;
  else if (trend_strength > 0.2) score += 4;

  // Precio en zona de reacción histórica
  if (features.price_in_zone === 1) score += 8;

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── 2. Bedrock qualitative score ──────────────────────────────────────────────

/**
 * Construye el prompt para Bedrock. Bedrock analiza el contexto cualitativo
 * de la señal (hora, día de semana, valores Stoch, momentum) y retorna
 * un JSON con score 0-100 y razonamiento.
 */
function buildBedrockPrompt(features, symbol, direction) {
  const hour    = features.hour_of_day;
  const day     = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][features.day_of_week] ?? '?';
  const isCrash = direction === 'SELL';
  const indexLabel = symbol.replace(/N$/, '').replace(/(\d+)/, ' $1');
  const trendDir = isCrash ? 'bajista (LH+LL confirmado)' : 'alcista (HH+HL confirmado)';

  return `Eres un experto en índices sintéticos Crash/Boom de Deriv. Evalúa la CALIDAD de esta señal de trading como un número entero de 0 a 100, donde 100 es la señal perfecta y 0 es muy mala.

SEÑAL:
- Índice: ${indexLabel}
- Dirección: ${direction === 'SELL' ? 'SELL (esperamos Crash/bajada)' : 'BUY (esperamos Boom/subida)'}
- Hora UTC: ${hour}:00 | Día: ${day}
- Tendencia 1H: ${features.trend_confirmed === 1 ? trendDir : 'NO confirmada ⚠️'}
- Stoch 1H:  K=${features.stoch_1h_k?.toFixed(1) ?? '?'}, D=${features.stoch_1h_d?.toFixed(1) ?? '?'}, hook=${features.stoch_1h_hook === 1 ? '✅ K cruzó D' : 'no'}
- Stoch 15M: K=${features.stoch_15m_k?.toFixed(1) ?? '?'}, D=${features.stoch_15m_d?.toFixed(1) ?? '?'}, hook=${features.stoch_15m_hook === 1 ? '✅ K cruzó D' : 'no'}
- Stoch 5M:  K=${features.stoch_5m_k?.toFixed(1) ?? '?'}, D=${features.stoch_5m_d?.toFixed(1) ?? '?'}
- Temporalidades alineadas: ${features.tf_alignment ?? 0}/3
- Precio en zona de reacción: ${features.price_in_zone === 1 ? 'SÍ ✅' : 'no'}
- Velas desde último swing: ${features.candles_since_swing ?? '?'}

CONTEXTO:
- Los índices ${isCrash ? 'Crash' : 'Boom'} tienen spikes ${isCrash ? 'bajistas' : 'alcistas'} aleatorios
- La mejor entrada es cuando: tendencia confirmada + Stoch en zona extrema en 3 TF + K cruza D (hook)
- Horario más activo: 08:00-16:00 UTC

Responde ÚNICAMENTE con este JSON (sin markdown, sin explicación extra):
{"score": <número 0-100>, "razon": "<máximo 80 caracteres en español>"}`;
}

/**
 * Invoca Bedrock claude-sonnet-4-5 y extrae el score cualitativo.
 * Retorna null si hay error (para no bloquear el pipeline).
 */
async function getBedrockScore(features, symbol, direction) {
  try {
    const prompt = buildBedrockPrompt(features, symbol, direction);

    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 128,
      temperature: 0.1,
      messages: [{ role: 'user', content: prompt }],
    };

    const cmd = new InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    });

    const resp = await bedrock.send(cmd);
    const raw  = JSON.parse(Buffer.from(resp.body).toString());
    const text = raw.content?.[0]?.text?.trim() ?? '';

    // Parse JSON response
    const parsed = JSON.parse(text);
    const score  = parseInt(parsed.score, 10);

    if (isNaN(score) || score < 0 || score > 100) {
      throw new Error(`Invalid score: ${parsed.score}`);
    }

    return { score, razon: parsed.razon ?? '' };
  } catch (e) {
    console.log(JSON.stringify({ action: 'bedrockScoreWarn', symbol, error: e.message }));
    return null;
  }
}

// ── 3. Journal score (historial personal) ─────────────────────────────────────

/**
 * Calcula el score de historial personal para un usuario + índice.
 * Basado en el win rate histórico del usuario en ese índice específico.
 * Si no hay historial suficiente → retorna 50 (neutral).
 */
async function getJournalScore(userId, symbol) {
  if (!userId || userId === '_system') return 50;

  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: TRADES_TABLE,
      IndexName: 'userId-fecha-index',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: '#ind = :sym AND attribute_not_exists(deleted)',
      ExpressionAttributeNames: { '#ind': 'indice' },
      ExpressionAttributeValues: {
        ':uid': { S: userId },
        ':sym': { S: symbol },
      },
      ProjectionExpression: 'resultado',
    }));

    const trades = (result.Items || []).map(i => unmarshall(i));
    if (trades.length < 10) return 50;  // not enough data

    const wins = trades.filter(t => t.resultado === 'win' || t.resultado === 'WIN').length;
    const winRate = wins / trades.length;

    // Map win rate to score: 50% = 50, 70% = 80, 80% = 95, 30% = 20
    const score = Math.round(winRate * 100);
    return Math.max(10, Math.min(100, score));
  } catch (e) {
    console.log(JSON.stringify({ action: 'journalScoreWarn', userId, symbol, error: e.message }));
    return 50;
  }
}

// ── 4. Score combiner ─────────────────────────────────────────────────────────

function combineScores(sagemakerScore, bedrockResult) {
  const s = sagemakerScore ?? 50;
  const b = bedrockResult?.score ?? 50;

  const final = Math.round(
    s * SCORE_WEIGHTS.sagemaker +
    b * SCORE_WEIGHTS.bedrock
  );

  return {
    sagemaker_score: s,
    bedrock_score:   b,
    final_score:     Math.max(0, Math.min(100, final)),
    bedrock_razon:   bedrockResult?.razon ?? null,
    fallback:        false,
    reason:          null,
  };
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const {
    features = {},
    symbol,
    direction,
    type,       // 'crash' | 'boom'
    userId,     // optional — for journal score
  } = event;

  console.log(JSON.stringify({ action: 'ml-scorer-start', symbol, direction, userId }));

  // 1. SageMaker — real endpoint with stoch-quality fallback
  const indexType = type || (direction === 'SELL' ? 'crash' : 'boom');
  let sagemakerScore = await getSageMakerScore(features, symbol);
  let usedFallback = false;
  if (sagemakerScore === null) {
    sagemakerScore = sagemakerFallback(features, indexType);
    usedFallback = true;
  }

  // 2. Bedrock score
  const bedrockResult = await getBedrockScore(features, symbol, direction);

  // 3. Combine (70% SageMaker + 30% Bedrock — sin historial personal)
  const result = combineScores(sagemakerScore, bedrockResult);
  result.fallback = usedFallback;

  console.log(JSON.stringify({
    action: 'ml-scorer-done',
    symbol,
    sagemaker: result.sagemaker_score,
    bedrock:   result.bedrock_score,
    journal:   result.journal_score,
    final:     result.final_score,
  }));

  return result;
};
