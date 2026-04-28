'use strict';

/**
 * SYNTRA 2.0 — step-orchestrator (Fase 1)
 * Invocado async por signal-worker cuando se detecta condicion de entrada.
 * 1. Anti-duplicado (30 min, mismo simbolo)
 * 2. Score fallback (Stoch quality 0-100)
 * 3. Guardar senal en DynamoDB
 * 4. Enviar notificacion Telegram
 */

const { DynamoDBClient, QueryCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall } = require('@aws-sdk/util-dynamodb');
const https  = require('https');
const crypto = require('crypto');

const dynamo        = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE_SIGNALS = process.env.DYNAMODB_TABLE_SIGNALS || 'syntra-signals';
const SCORE_MIN     = parseInt(process.env.SCORE_MIN_ENTRY || '65', 10);
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID   || '';
const ADMIN_UID     = process.env.ADMIN_USER_ID       || 'SYSTEM';

// Anti-duplicado: mismo simbolo, ultimos 30 min, estado != skipped
async function isDuplicate(symbol) {
  const windowMs = 30 * 60 * 1000;
  const cutoff   = new Date(Date.now() - windowMs).toISOString();

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

// Score fallback 0-100 usando los valores Stoch directos del evento
function calcFallbackScore(signal) {
  const tipo = signal.tipo;
  const k1h  = signal.stoch_1h_k != null ? signal.stoch_1h_k : 50;
  const d1h  = signal.stoch_1h_d != null ? signal.stoch_1h_d : 50;
  const k5m  = signal.stoch_5m_k != null ? signal.stoch_5m_k : 50;
  const d5m  = signal.stoch_5m_d != null ? signal.stoch_5m_d : 50;
  const k1m  = signal.stoch_1m_k != null ? signal.stoch_1m_k : null;
  const d1m  = signal.stoch_1m_d != null ? signal.stoch_1m_d : null;

  let score = 50;

  // 1. Profundidad en zona 1H (hasta +20)
  if (tipo === 'CRASH') {
    score += Math.min(20, Math.max(0, (k1h - 80) * 2));
  } else {
    score += Math.min(20, Math.max(0, (20 - k1h) * 2));
  }

  // 2. Alineacion K-D en 1H (hasta +15)
  const kdDiff1h = Math.abs(k1h - d1h);
  score += Math.min(15, kdDiff1h * 0.5);

  // 3. Confirmacion 5M (hasta +10)
  if (tipo === 'CRASH') {
    score += Math.min(10, Math.max(0, (k5m - 80) * 0.5));
    score += Math.min(5,  Math.max(0, (d5m - 80) * 0.25));
  } else {
    score += Math.min(10, Math.max(0, (20 - k5m) * 0.5));
    score += Math.min(5,  Math.max(0, (20 - d5m) * 0.25));
  }

  // 4. Confirmacion 1M si existe (hasta +5 bonus)
  if (k1m != null && d1m != null) {
    if (tipo === 'CRASH' && k1m > 80 && d1m > 80) score += 5;
    if (tipo === 'BOOM'  && k1m < 20 && d1m < 20) score += 5;
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

// Guarda senal en syntra-signals
async function saveSignal(signal, score, status) {
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
    stoch_1h_k:        signal.stoch_1h_k,
    stoch_1h_d:        signal.stoch_1h_d,
    stoch_5m_k:        signal.stoch_5m_k,
    stoch_5m_d:        signal.stoch_5m_d,
    stoch_1m_k:        signal.stoch_1m_k != null ? signal.stoch_1m_k : null,
    stoch_1m_d:        signal.stoch_1m_d != null ? signal.stoch_1m_d : null,
    score,
    status,
    features:          JSON.stringify(signal.features || {}),
    zone:              JSON.stringify(signal.zone || {}),
    createdAt:         ts,
    ttl:               Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
  };

  await dynamo.send(new PutItemCommand({
    TableName: TABLE_SIGNALS,
    Item:      marshall(item, { removeUndefinedValues: true }),
  }));

  console.log(JSON.stringify({ action: 'signal_saved', symbol: signal.symbol, score, status }));
  return item;
}

// Construye mensaje HTML para Telegram con emojis y zona de reacción
function buildTelegramMessage(signal, score) {
  const isCrash  = signal.tipo === 'CRASH';
  const typeEmoji = isCrash ? '💥' : '🚀';
  const dirEmoji  = isCrash ? '🔴' : '🟢';
  const dir       = signal.direccion === 'SELL' ? 'SELL LIMIT' : 'BUY LIMIT';

  const k1h = signal.stoch_1h_k != null ? signal.stoch_1h_k.toFixed(1) : 'N/A';
  const d1h = signal.stoch_1h_d != null ? signal.stoch_1h_d.toFixed(1) : 'N/A';
  const k5m = signal.stoch_5m_k != null ? signal.stoch_5m_k.toFixed(1) : 'N/A';
  const d5m = signal.stoch_5m_d != null ? signal.stoch_5m_d.toFixed(1) : 'N/A';

  // Score bar
  const scoreBar = score >= 85 ? '🔥🔥🔥' : score >= 75 ? '⭐⭐⭐' : score >= 65 ? '⭐⭐' : '⭐';

  let msg = typeEmoji + ' <b>SYNTRA SIGNAL — ' + signal.tipo + '</b> ' + dirEmoji + '\n';
  msg += '<b>' + signal.symbol + '</b>  |  ' + dir + '\n';
  msg += '─────────────────────\n\n';

  // Zone analysis
  const zone = signal.zone;
  if (zone && zone.zone) {
    const z = zone.zone;
    const inZone = zone.priceInZone;
    const zoneEmoji = inZone ? '✅' : '⚠️';
    const distStr   = zone.distancePct != null ? (zone.distancePct > 0 ? '+' : '') + zone.distancePct + '%' : '—';

    msg += '🏗 <b>Zona de reacción ' + (isCrash ? 'resistencia' : 'soporte') + '</b>\n';
    if (z.levels && z.levels.length) {
      msg += '   Niveles: ' + z.levels.join(' · ') + '\n';
    }
    msg += '   Rango: <code>' + z.min + '</code> — <code>' + z.max + '</code>\n';
    msg += '   Distancia al mid: <code>' + distStr + '</code>  ' + zoneEmoji + (inZone ? ' EN ZONA' : ' fuera de zona') + '\n\n';

    if (zone.limitEntry) {
      msg += '📍 <b>Entrada sugerida:</b> <code>' + zone.limitEntry + '</code>  (' + (isCrash ? 'SELL LIMIT en resistencia' : 'BUY LIMIT en soporte') + ')\n';
    }
  } else {
    msg += '📍 <b>Entrada actual:</b> <code>' + signal.entrada + '</code>\n';
  }

  msg += '🛡 <b>Stop Loss:</b>  <code>' + signal.sl + '</code>  (' + signal.sl_puntos + ' pts)\n';
  msg += '🎯 <b>Take Profit:</b> <code>' + signal.tp + '</code>  (' + signal.tp_puntos + ' pts)\n\n';

  msg += '─────────────────────\n';
  msg += '📊 <b>Stoch (5,3,3)</b>\n';
  msg += '   1H → K=<code>' + k1h + '</code>  D=<code>' + d1h + '</code>\n';
  msg += '   5M → K=<code>' + k5m + '</code>  D=<code>' + d5m + '</code>\n';

  if (signal.stoch_1m_k != null) {
    const k1m = signal.stoch_1m_k.toFixed(1);
    const d1m = signal.stoch_1m_d != null ? signal.stoch_1m_d.toFixed(1) : 'N/A';
    msg += '   1M → K=<code>' + k1m + '</code>  D=<code>' + d1m + '</code>\n';
  }

  msg += '\n⚡ <b>Score:</b> <code>' + score + '/100</code>  ' + scoreBar + '\n';
  msg += '🕐 ' + new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' });

  return msg;
}

// Envia mensaje via Telegram Bot API
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
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
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
          console.log(JSON.stringify({ action: 'telegram_sent', message_id: parsed.result && parsed.result.message_id }));
          resolve(parsed.result);
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Telegram timeout')); });
    req.write(body);
    req.end();
  });
}

// Handler principal
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'start', symbol: event.symbol }));

  try {
    // 1. Anti-duplicado
    const dup = await isDuplicate(event.symbol);
    if (dup) {
      console.log(JSON.stringify({ action: 'duplicate_skip', symbol: event.symbol }));
      await saveSignal(event, 0, 'skipped');
      return { skipped: true, reason: 'duplicate' };
    }

    // 2. Score fallback (usa los valores Stoch directos del evento)
    const score = calcFallbackScore(event);

    // 3. Guardar senal
    const status = score >= SCORE_MIN ? 'open' : 'low_score';
    await saveSignal(event, score, status);

    // 4. Notificar si cumple score minimo
    if (status === 'open') {
      const msg = buildTelegramMessage(event, score);
      await sendTelegram(msg, CHAT_ID).catch(function(err) {
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
