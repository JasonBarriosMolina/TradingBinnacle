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
const { DynamoDBClient, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamo  = new DynamoDBClient({ region: 'us-east-1' });

const TRADES_TABLE   = process.env.DYNAMODB_TABLE_TRADES || 'syntra-trades';
const BEDROCK_MODEL  = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';
const SCORE_WEIGHTS  = { sagemaker: 0.55, bedrock: 0.25, journal: 0.20 };

// ── 1. SageMaker fallback (Fase 3 reemplazará esto) ──────────────────────────

/**
 * Stochastic quality score — fallback hasta que SageMaker está entrenado.
 * Penaliza si K y D están muy cerca del umbral (señal débil) o demasiado
 * lejos (posible reversión). Premia divergencia y pendiente sostenida.
 */
function sagemakerFallback(features, indexType) {
  let score = 50;
  const isCrash = indexType === 'crash';

  // Fortaleza de la señal en 1H
  const kd_diff_1h = Math.abs(features.stoch_1h_kd_diff ?? 0);
  if (kd_diff_1h > 5)  score += 15;
  else if (kd_diff_1h > 2) score += 8;
  else score -= 5;  // K y D demasiado juntos = señal ambigua

  // Pendiente de D en 1H (momentum del indicador)
  const d_slope_1h = features.stoch_1h_d_slope ?? 0;
  const expectedSlope = isCrash ? 1 : -1;  // crash: D subiendo; boom: D bajando
  if (d_slope_1h * expectedSlope > 0.5) score += 10;
  else if (d_slope_1h * expectedSlope < -0.5) score -= 8;

  // Confirmación en 5M
  const kd_diff_5m = Math.abs(features.stoch_5m_kd_diff ?? 0);
  if (kd_diff_5m > 3) score += 10;
  else if (kd_diff_5m > 1) score += 5;

  // Ticks desde último spike (más ticks = más presión acumulada)
  const ticks = features.ticks_since_last_spike;
  if (ticks != null) {
    if (ticks > 500)      score += 12;
    else if (ticks > 200) score += 8;
    else if (ticks < 50)  score -= 10;  // spike muy reciente
  }

  // Volatilidad (ratio 30t/300t): alta ratio = mercado activo = mejor entrada
  const vol_ratio = features.volatility_ratio;
  if (vol_ratio != null) {
    if (vol_ratio > 1.5) score += 5;
    else if (vol_ratio < 0.5) score -= 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

// ── 2. Bedrock qualitative score ──────────────────────────────────────────────

/**
 * Construye el prompt para Bedrock. Bedrock analiza el contexto cualitativo
 * de la señal (hora, día de semana, valores Stoch, momentum) y retorna
 * un JSON con score 0-100 y razonamiento.
 */
function buildBedrockPrompt(features, symbol, direction) {
  const hour = features.hour_of_day;
  const day  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'][features.day_of_week] ?? '?';
  const isCrash = direction === 'SELL';
  const indexLabel = symbol.replace(/N$/, '').replace(/(\d+)/, ' $1');

  return `Eres un experto en índices sintéticos Crash/Boom de Deriv. Evalúa la CALIDAD de esta señal de trading como un número entero de 0 a 100, donde 100 es la señal perfecta y 0 es muy mala.

SEÑAL:
- Índice: ${indexLabel}
- Dirección: ${direction === 'SELL' ? 'SELL (esperamos Crash/bajada)' : 'BUY (esperamos Boom/subida)'}
- Hora UTC: ${hour}:00
- Día: ${day}
- Stoch 1H: K=${features.stoch_1h_k?.toFixed(1) ?? '?'}, D=${features.stoch_1h_d?.toFixed(1) ?? '?'}, diferencia=${features.stoch_1h_kd_diff?.toFixed(1) ?? '?'}
- Stoch 5M: K=${features.stoch_5m_k?.toFixed(1) ?? '?'}, D=${features.stoch_5m_d?.toFixed(1) ?? '?'}
${features.stoch_1m_k != null ? `- Stoch 1M: K=${features.stoch_1m_k?.toFixed(1)}, D=${features.stoch_1m_d?.toFixed(1)}` : ''}
- Ticks desde último spike: ${features.ticks_since_last_spike ?? 'desconocido'}
- Velocidad drift 10t: ${features.drift_velocity_10t?.toFixed(4) ?? '?'}
- Volatilidad ratio: ${features.volatility_ratio?.toFixed(2) ?? '?'}

CONTEXTO:
- Los índices ${isCrash ? 'Crash' : 'Boom'} tienen spikes ${isCrash ? 'bajistas' : 'alcistas'} aleatorios
- El Stochastic (5,3,3) con K y D ambos ${isCrash ? '> 80' : '< 20'} indica ${isCrash ? 'sobrecompra extrema antes del crash' : 'sobreventa extrema antes del boom'}
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

function combineScores(sagemakerScore, bedrockResult, journalScore) {
  const s = sagemakerScore ?? 50;
  const b = bedrockResult?.score ?? 50;
  const j = journalScore ?? 50;

  const final = Math.round(
    s * SCORE_WEIGHTS.sagemaker +
    b * SCORE_WEIGHTS.bedrock   +
    j * SCORE_WEIGHTS.journal
  );

  return {
    sagemaker_score: s,
    bedrock_score:   b,
    journal_score:   j,
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

  // 1. SageMaker (fallback until Phase 3)
  const sagemakerScore = sagemakerFallback(features, type || (direction === 'SELL' ? 'crash' : 'boom'));

  // 2. Bedrock + journal score in parallel
  const [bedrockResult, journalScore] = await Promise.all([
    getBedrockScore(features, symbol, direction),
    getJournalScore(userId, symbol),
  ]);

  // 3. Combine
  const result = combineScores(sagemakerScore, bedrockResult, journalScore);

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
