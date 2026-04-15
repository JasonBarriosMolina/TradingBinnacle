'use strict';
/**
 * SYNTRA 2.0 — weekly-report
 *
 * Disparado por EventBridge cada domingo a las 20:00 UTC (14:00 CR).
 * Para cada usuario pro/elite:
 *   1. Obtiene stats de la semana (trades, win rate, P&L, por índice)
 *   2. Bedrock genera análisis personalizado en español
 *   3. Envía por Telegram al usuario
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient, ScanCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { unmarshall } = require('@aws-sdk/util-dynamodb');

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamo  = new DynamoDBClient({ region: 'us-east-1' });

const USERS_TABLE   = process.env.DYNAMODB_TABLE_USERS  || 'syntra-users';
const TRADES_TABLE  = process.env.DYNAMODB_TABLE_TRADES || 'syntra-trades';
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';

// ── Helpers ───────────────────────────────────────────────────────────────────

function getWeekRange() {
  const now  = new Date();
  const day  = now.getUTCDay();
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1);
  const mon  = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  const sun  = new Date(mon.getTime() + 6 * 24 * 60 * 60 * 1000);
  return {
    start: mon.toISOString().slice(0, 10),
    end:   sun.toISOString().slice(0, 10),
  };
}

async function getEligibleUsers() {
  const items = [];
  let lastKey;
  do {
    const res = await dynamo.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: '(#plan = :pro OR #plan = :elite) AND attribute_exists(telegram_chat_id)',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: {
        ':pro':   { S: 'pro' },
        ':elite': { S: 'elite' },
      },
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    }));
    (res.Items || []).forEach(i => items.push(unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

async function getWeekTrades(userId, weekStart, weekEnd) {
  const result = await dynamo.send(new QueryCommand({
    TableName: TRADES_TABLE,
    IndexName: 'userId-fecha-index',
    KeyConditionExpression: 'userId = :uid AND fecha BETWEEN :start AND :end',
    FilterExpression: 'attribute_not_exists(deleted)',
    ExpressionAttributeValues: {
      ':uid':   { S: userId },
      ':start': { S: weekStart },
      ':end':   { S: weekEnd },
    },
    ScanIndexForward: false,
  }));
  return (result.Items || []).map(i => unmarshall(i));
}

function aggregateTrades(trades) {
  let wins = 0, pnl = 0;
  const byIndex = {};

  for (const t of trades) {
    const p = typeof t.pnl === 'number' ? t.pnl : 0;
    pnl += p;
    const isWin = (t.resultado || '').toUpperCase() === 'WIN';
    if (isWin) wins++;
    const idx = t.indice || 'UNKNOWN';
    if (!byIndex[idx]) byIndex[idx] = { trades: 0, wins: 0, pnl: 0 };
    byIndex[idx].trades++;
    byIndex[idx].pnl += p;
    if (isWin) byIndex[idx].wins++;
  }

  return {
    total: trades.length,
    wins,
    losses: trades.length - wins,
    winRate: trades.length > 0 ? Math.round((wins / trades.length) * 100) : 0,
    pnl: Math.round(pnl * 100) / 100,
    byIndex,
  };
}

// ── Bedrock report generation ─────────────────────────────────────────────────

async function generateReport(user, stats, weekRange) {
  const indexLines = Object.entries(stats.byIndex)
    .map(([idx, s]) => `  ${idx}: ${s.trades} trades, ${s.trades > 0 ? Math.round(s.wins/s.trades*100) : 0}% WR, P&L: $${s.pnl.toFixed(2)}`)
    .join('\n');

  const prompt = `Eres SYNTRA Copiloto. Genera un reporte semanal de trading CONCISO para un trader de índices sintéticos Crash/Boom.

SEMANA: ${weekRange.start} al ${weekRange.end}

ESTADÍSTICAS:
- Total operaciones: ${stats.total}
- Victorias: ${stats.wins} | Pérdidas: ${stats.losses}
- Win Rate: ${stats.winRate}%
- P&L semana: $${stats.pnl}
- Capital: $${(user.capital_inicial || 0).toFixed(2)}

POR ÍNDICE:
${indexLines || '  Sin operaciones esta semana'}

REGLAS DEL SISTEMA (para contexto):
- Estrategia: Stochastic(5,3,3), SL=14pt, TP=28pt, RR 1:2
- ${stats.winRate >= 55 ? 'Win rate bueno — continuar estrategia' : 'Win rate bajo — revisar condiciones de entrada'}

Genera un reporte en español, máximo 200 palabras, con:
1. Resumen de la semana (1-2 oraciones)
2. Punto positivo principal
3. Área de mejora principal
4. Recomendación para la próxima semana

Sé directo y específico con los números. Tono profesional pero motivador.`;

  try {
    const body = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 400,
      temperature: 0.6,
      messages: [{ role: 'user', content: prompt }],
    };
    const resp = await bedrock.send(new InvokeModelCommand({
      modelId: BEDROCK_MODEL,
      contentType: 'application/json',
      accept: 'application/json',
      body: Buffer.from(JSON.stringify(body)),
    }));
    const raw = JSON.parse(Buffer.from(resp.body).toString());
    return raw.content?.[0]?.text?.trim() ?? null;
  } catch (e) {
    console.log(JSON.stringify({ action: 'bedrockReportWarn', error: e.message }));
    return null;
  }
}

// ── Telegram sender ───────────────────────────────────────────────────────────

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_TOKEN || !chatId) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
    return res.ok;
  } catch (e) {
    console.log(JSON.stringify({ action: 'telegramWarn', chatId, error: e.message }));
    return false;
  }
}

function formatTelegramReport(weekRange, stats, bedrockText) {
  const emoji = stats.winRate >= 60 ? '🟢' : stats.winRate >= 45 ? '🟡' : '🔴';
  const pnlSign = stats.pnl >= 0 ? '+' : '';

  let msg = `📊 <b>SYNTRA — Reporte Semanal</b>
${weekRange.start} → ${weekRange.end}

${emoji} <b>${stats.total} trades</b> · ${stats.winRate}% WR · <b>${pnlSign}$${stats.pnl}</b>

`;

  if (bedrockText) {
    msg += `${bedrockText}\n\n`;
  } else {
    msg += `Win: ${stats.wins} | Loss: ${stats.losses}\n\n`;
  }

  msg += `<i>Abre SYNTRA para ver tus estadísticas completas →</i>`;
  return msg;
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const weekRange = getWeekRange();
  console.log(JSON.stringify({ action: 'weekly-report-start', week: weekRange }));

  const users = await getEligibleUsers();
  console.log(JSON.stringify({ action: 'weekly-report-users', count: users.length }));

  let sent = 0, errors = 0;

  for (const user of users) {
    try {
      const trades = await getWeekTrades(user.userId, weekRange.start, weekRange.end);
      const stats  = aggregateTrades(trades);

      const bedrockText = stats.total > 0
        ? await generateReport(user, stats, weekRange)
        : null;

      const msg = formatTelegramReport(weekRange, stats, bedrockText);
      const ok  = await sendTelegram(user.telegram_chat_id, msg);

      if (ok) sent++;
      else errors++;

      console.log(JSON.stringify({
        action: 'report-sent',
        userId: user.userId,
        trades: stats.total,
        winRate: stats.winRate,
        pnl: stats.pnl,
        ok,
      }));

      // Small delay to avoid Telegram rate limits
      await new Promise(r => setTimeout(r, 200));
    } catch (e) {
      errors++;
      console.log(JSON.stringify({ action: 'report-error', userId: user.userId, error: e.message }));
    }
  }

  console.log(JSON.stringify({ action: 'weekly-report-done', sent, errors, total: users.length }));
  return { sent, errors, total: users.length, week: weekRange };
};
