'use strict';

/**
 * SYNTRA 2.0 — step-orchestrator (v3)
 * Invocado async por signal-worker cuando se detecta condicion de entrada.
 *
 * Pipeline:
 *   1. Anti-duplicado (30 min, mismo símbolo) — DynamoDB
 *   2. Score ML real → invoca ml-scorer (70% SageMaker + 30% Bedrock)
 *   3. Guardar señal en DynamoDB
 *   4. Enviar notificación Telegram si score >= 65
 */

const { DynamoDBClient, QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand }                  = require('@aws-sdk/client-lambda');
const { marshall }                                      = require('@aws-sdk/util-dynamodb');
const https  = require('https');
const crypto = require('crypto');

const dynamo        = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const lambdaClient  = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

const TABLE_SIGNALS = process.env.DYNAMODB_TABLE_SIGNALS || 'syntra-signals';
const SCORE_MIN     = parseInt(process.env.SCORE_MIN_ENTRY || '65', 10);
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID   || '';
const ADMIN_UID     = process.env.ADMIN_USER_ID       || 'SYSTEM';

// ── 1. Anti-duplicado ─────────────────────────────────────────────────────────

async function isDuplicate(symbol) {
  const cutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const resp = await dynamo.send(new QueryCommand({
    TableName:                TABLE_SIGNALS,
    KeyConditionExpression:   'userId = :uid AND timestampSignalId >= :cut',
    FilterExpression:         'symbol = :sym AND #st <> :skip',
    ExpressionAttributeNames: { '#st': 'status' },
    ExpressionAttributeValues: marshall({
      ':uid':  ADMIN_UID,
      ':cut':  cutoff,
      ':sym':  symbol,
      ':skip': 'skipped',
    }),
    Limit: 1,
  }));
  return (resp.Count || 0) > 0;
}

// ── 2. ML Score (real) ────────────────────────────────────────────────────────

/**
 * Invoca ml-scorer Lambda y retorna el resultado completo.
 * Si falla → usa fallback basado en stoch para no bloquear la señal.
 */
async function getMlScore(event) {
  try {
    const myName      = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
    const scorerName  = myName.replace('step-orchestrator', 'ml-scorer');

    const payload = {
      features:  event.features  || {},
      symbol:    event.symbol,
      direction: event.direccion,
      type:      event.tipo?.toLowerCase(),
    };

    const resp = await lambdaClient.send(new InvokeCommand({
      FunctionName:   scorerName,
      InvocationType: 'RequestResponse',
      Payload:        Buffer.from(JSON.stringify(payload)),
    }));

    const result = JSON.parse(Buffer.from(resp.Payload).toString());

    if (result.errorMessage) throw new Error(result.errorMessage);

    console.log(JSON.stringify({
      action:   'ml-score-received',
      symbol:   event.symbol,
      sagemaker: result.sagemaker_score,
      bedrock:   result.bedrock_score,
      final:     result.final_score,
      fallback:  result.fallback,
    }));

    return result;

  } catch (e) {
    console.error(JSON.stringify({ action: 'ml-score-error', symbol: event.symbol, error: e.message }));
    // Fallback local mínimo — no bloquea la señal
    return {
      sagemaker_score: null,
      bedrock_score:   null,
      final_score:     65,   // pasa el umbral mínimo para no silenciar señales válidas
      bedrock_razon:   null,
      fallback:        true,
    };
  }
}

// ── 3. Guardar señal ──────────────────────────────────────────────────────────

async function saveSignal(signal, mlResult, status) {
  const ts  = new Date().toISOString();
  const uid = crypto.randomUUID();

  const item = {
    userId:            ADMIN_UID,
    timestampSignalId: ts + '#' + uid,
    symbol:            signal.symbol,
    tipo:              signal.tipo,
    direccion:         signal.direccion,
    entrada:           signal.entrada,
    sl:                signal.sl,
    tp:                signal.tp,
    sl_puntos:         signal.sl_puntos,
    tp_puntos:         signal.tp_puntos,

    // Stoch values — 3 TF
    stoch_1h_k:   signal.stoch_1h_k,
    stoch_1h_d:   signal.stoch_1h_d,
    stoch_15m_k:  signal.stoch_15m_k,
    stoch_15m_d:  signal.stoch_15m_d,
    stoch_5m_k:   signal.stoch_5m_k,
    stoch_5m_d:   signal.stoch_5m_d,
    hook_1h:      signal.hook_1h  ? 1 : 0,
    hook_15m:     signal.hook_15m ? 1 : 0,

    // Trend & alignment
    trend_confirmed: signal.trend_confirmed,
    tf_alignment:    signal.tf_alignment,

    // ML scores
    score:           mlResult.final_score,
    sagemaker_score: mlResult.sagemaker_score,
    bedrock_score:   mlResult.bedrock_score,
    bedrock_razon:   mlResult.bedrock_razon || null,
    score_fallback:  mlResult.fallback ? 1 : 0,

    status,
    features:  JSON.stringify(signal.features || {}),
    zone:      JSON.stringify(signal.zone || {}),
    createdAt: ts,
    ttl:       Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_SIGNALS,
    Item:      marshall(item, { removeUndefinedValues: true }),
  }));

  console.log(JSON.stringify({ action: 'signal_saved', symbol: signal.symbol, score: mlResult.final_score, status }));
  return item;
}

// ── 4. Telegram message ───────────────────────────────────────────────────────

function fmt(v, dec = 1) {
  return v != null ? (+v).toFixed(dec) : 'N/A';
}

function buildTelegramMessage(signal, mlResult) {
  const isCrash    = signal.tipo === 'CRASH';
  const typeEmoji  = isCrash ? '💥' : '🚀';
  const dirEmoji   = isCrash ? '🔴' : '🟢';
  const score      = mlResult.final_score;
  const scoreBar   = score >= 85 ? '🔥🔥🔥' : score >= 75 ? '⭐⭐⭐' : '⭐⭐';

  // Trend line
  const trendOk    = signal.trend_confirmed === 1;
  const trendLabel = isCrash ? 'LH+LL' : 'HH+HL';
  const trendLine  = trendOk ? `✅ ${trendLabel} confirmado` : `⚠️ sin estructura`;

  // Zone
  const zone       = signal.zone || {};
  const inZone     = zone.priceInZone;
  const zoneLine   = inZone
    ? `✅ EN zona ${isCrash ? 'resistencia' : 'soporte'}`
    : zone.distancePct != null
      ? `⚠️ ${Math.abs(zone.distancePct).toFixed(2)}% fuera de zona`
      : '—';

  // Hook labels
  const h1h  = signal.hook_1h  ? ' 🪝' : '';
  const h15m = signal.hook_15m ? ' 🪝' : '';

  // Score detail line (only if both scores available)
  let scoreLine = `<code>${score}/100</code>  ${scoreBar}`;
  if (mlResult.sagemaker_score != null && mlResult.bedrock_score != null) {
    scoreLine += `\n   SM=<code>${mlResult.sagemaker_score}</code>  AI=<code>${mlResult.bedrock_score}</code>`;
    if (mlResult.fallback) scoreLine += '  <i>(fallback)</i>';
  }
  if (mlResult.bedrock_razon) {
    scoreLine += `\n   <i>${mlResult.bedrock_razon}</i>`;
  }

  // Time in CR
  const now = new Date().toLocaleString('es-CR', {
    timeZone:   'America/Costa_Rica',
    weekday:    'short',
    day:        '2-digit',
    month:      'short',
    hour:       '2-digit',
    minute:     '2-digit',
  });

  // Número de entrada formateado
  const entrada = parseFloat(signal.entrada).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const sl      = parseFloat(signal.sl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });
  const tp      = parseFloat(signal.tp).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 });

  let msg = '';
  msg += `${typeEmoji} <b>SYNTRA — ${signal.symbol}</b>  ${dirEmoji} <b>${signal.direccion}</b>\n`;
  msg += `─────────────────────────\n`;
  msg += `📍 <b>Entrada:</b>     <code>${entrada}</code>\n`;
  msg += `🛡 <b>Stop Loss:</b>   <code>${sl}</code>  (${signal.sl_puntos} pts)\n`;
  msg += `🎯 <b>Take Profit:</b> <code>${tp}</code>  (${signal.tp_puntos} pts)\n`;
  msg += `\n`;
  msg += `📊 <b>Tendencia 1H:</b>  ${trendLine}\n`;
  msg += `🔗 <b>TF alineadas:</b>  ${signal.tf_alignment ?? '?'}/3\n`;
  msg += `🏛 <b>Zona:</b>          ${zoneLine}\n`;
  msg += `\n`;
  msg += `📈 <b>Stoch (5,3,3)</b>\n`;
  msg += `   1H  → K=<code>${fmt(signal.stoch_1h_k)}</code>  D=<code>${fmt(signal.stoch_1h_d)}</code>${h1h}\n`;
  msg += `   15M → K=<code>${fmt(signal.stoch_15m_k)}</code>  D=<code>${fmt(signal.stoch_15m_d)}</code>${h15m}\n`;
  msg += `   5M  → K=<code>${fmt(signal.stoch_5m_k)}</code>  D=<code>${fmt(signal.stoch_5m_d)}</code>\n`;
  msg += `\n`;
  msg += `⚡ <b>Score:</b>  ${scoreLine}\n`;
  msg += `🕐 ${now}`;

  return msg;
}

// ── Telegram sender ───────────────────────────────────────────────────────────

function sendTelegram(text, chatId) {
  return new Promise((resolve, reject) => {
    if (!BOT_TOKEN || !chatId) {
      console.warn(JSON.stringify({ action: 'telegram_skip', reason: 'not_configured' }));
      return resolve(null);
    }

    const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
    const opts = {
      hostname: 'api.telegram.org',
      path:     '/bot' + BOT_TOKEN + '/sendMessage',
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };

    const req = https.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (!parsed.ok) {
            console.error(JSON.stringify({ action: 'telegram_error', error: parsed }));
            return reject(new Error('Telegram API: ' + parsed.description));
          }
          console.log(JSON.stringify({ action: 'telegram_sent', message_id: parsed.result?.message_id }));
          resolve(parsed.result);
        } catch (e) { reject(e); }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'start', symbol: event.symbol, direction: event.direccion }));

  try {
    // 1. Anti-duplicado
    if (await isDuplicate(event.symbol)) {
      console.log(JSON.stringify({ action: 'duplicate_skip', symbol: event.symbol }));
      await saveSignal(event, { final_score: 0, fallback: false }, 'skipped');
      return { skipped: true, reason: 'duplicate' };
    }

    // 2. Score ML real (SageMaker 70% + Bedrock 30%)
    const mlResult = await getMlScore(event);
    const score    = mlResult.final_score;

    // 3. Guardar señal
    const status = score >= SCORE_MIN ? 'open' : 'low_score';
    await saveSignal(event, mlResult, status);

    // 4. Notificar si cumple score mínimo
    if (status === 'open') {
      const msg = buildTelegramMessage(event, mlResult);
      await sendTelegram(msg, CHAT_ID).catch(err => {
        console.error(JSON.stringify({ action: 'telegram_fail', error: err.message }));
      });
    } else {
      console.log(JSON.stringify({ action: 'score_too_low', symbol: event.symbol, score, min: SCORE_MIN }));
    }

    return { processed: true, symbol: event.symbol, score, status };

  } catch (err) {
    console.error(JSON.stringify({ action: 'handler_error', error: err.message }));
    throw err;
  }
};
