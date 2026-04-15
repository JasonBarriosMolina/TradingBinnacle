'use strict';
/**
 * SYNTRA 2.0 — copilot-api
 *
 * Chat con Bedrock claude-sonnet-4-5.
 * Contexto: últimos 100 trades + stats personales del usuario.
 * Responde siempre en español.
 *
 * POST /copilot  { message: string, history?: [{role, content}] }
 * GET  /copilot/suggestions  → preguntas sugeridas
 */

const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const bedrock = new BedrockRuntimeClient({ region: 'us-east-1' });
const dynamo  = new DynamoDBClient({ region: 'us-east-1' });

const USERS_TABLE   = process.env.DYNAMODB_TABLE_USERS  || 'syntra-users';
const TRADES_TABLE  = process.env.DYNAMODB_TABLE_TRADES || 'syntra-trades';
const BEDROCK_MODEL = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20251001-v1:0';
const MAX_TRADES    = 100;
const MAX_TOKENS    = 1024;

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

function ok(body)          { return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) }; }
function err(msg, s = 400) { return { statusCode: s, headers: corsHeaders, body: JSON.stringify({ error: msg }) }; }
function getUserId(e)      { return e.requestContext?.authorizer?.claims?.sub; }

// ── Context builder ──────────────────────────────────────────────────────────

async function buildUserContext(userId) {
  const [userRes, tradesRes] = await Promise.all([
    dynamo.send(new GetItemCommand({ TableName: USERS_TABLE, Key: marshall({ userId }) })),
    dynamo.send(new QueryCommand({
      TableName: TRADES_TABLE,
      IndexName: 'userId-fecha-index',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'attribute_not_exists(deleted)',
      ExpressionAttributeValues: { ':uid': { S: userId } },
      ScanIndexForward: false,
      Limit: MAX_TRADES,
    })),
  ]);

  const user   = userRes.Item ? unmarshall(userRes.Item) : {};
  const trades = (tradesRes.Items || []).map(i => unmarshall(i));

  // Aggregate stats
  let wins = 0, pnlTotal = 0, pnlWeek = 0;
  const byIndex = {};
  const weekStart = (() => {
    const d = new Date();
    const diff = d.getUTCDate() - d.getUTCDay() + (d.getUTCDay() === 0 ? -6 : 1);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().slice(0, 10);
  })();

  for (const t of trades) {
    const pnl = typeof t.pnl === 'number' ? t.pnl : 0;
    pnlTotal += pnl;
    if ((t.fecha || '').slice(0, 10) >= weekStart) pnlWeek += pnl;
    if (t.resultado === 'WIN' || t.resultado === 'win') wins++;
    const idx = t.indice || 'UNKNOWN';
    if (!byIndex[idx]) byIndex[idx] = { trades: 0, wins: 0 };
    byIndex[idx].trades++;
    if (t.resultado === 'WIN' || t.resultado === 'win') byIndex[idx].wins++;
  }

  const totalTrades = trades.length;
  const winRate = totalTrades > 0 ? Math.round((wins / totalTrades) * 100) : 0;

  // Best and worst indices
  const indexStats = Object.entries(byIndex)
    .map(([idx, s]) => ({
      idx,
      trades: s.trades,
      winRate: s.trades > 0 ? Math.round((s.wins / s.trades) * 100) : 0,
    }))
    .sort((a, b) => b.winRate - a.winRate);

  // Last 10 trades summary
  const lastTrades = trades.slice(0, 10).map(t => ({
    indice:    t.indice,
    resultado: t.resultado,
    pnl:       t.pnl?.toFixed(2),
    fecha:     t.fecha,
  }));

  // Check negative streak
  const lastResults = trades.slice(0, 5).map(t => t.resultado?.toUpperCase());
  const lossStreak  = lastResults.filter(r => r === 'LOSS').length;
  const rachaNegativa = lossStreak >= 3;

  return {
    user: {
      plan:            user.plan || 'free',
      capital:         (user.capital_inicial || 0) + pnlTotal,
      lotaje:          user.lotaje_actual || 0.01,
      indicesActivos:  user.indices_activos || [],
    },
    stats: {
      totalTrades,
      winRate,
      pnlTotal:   Math.round(pnlTotal * 100) / 100,
      pnlWeek:    Math.round(pnlWeek  * 100) / 100,
      rachaNegativa,
      lossStreak,
      mejorIndice: indexStats[0]?.idx,
      mejorWR:     indexStats[0]?.winRate,
      peorIndice:  indexStats[indexStats.length - 1]?.idx,
    },
    lastTrades,
    indexStats: indexStats.slice(0, 5),
  };
}

function buildSystemPrompt(ctx) {
  const { user, stats, lastTrades, indexStats } = ctx;

  const indexSummary = indexStats
    .map(s => `  - ${s.idx}: ${s.trades} trades, ${s.winRate}% WR`)
    .join('\n');

  const recentTrades = lastTrades
    .map(t => `  ${t.fecha || '?'} | ${t.indice} | ${t.resultado || 'open'} | P&L: ${t.pnl ?? '?'}`)
    .join('\n');

  return `Eres SYNTRA Copiloto, un asistente experto en trading de índices sintéticos Crash/Boom de Deriv.

PERFIL DEL TRADER:
- Plan: ${user.plan}
- Capital actual: $${user.capital.toFixed(2)}
- Lotaje actual: ${user.lotaje}
- Índices activos: ${user.indicesActivos.join(', ') || 'ninguno'}

ESTADÍSTICAS:
- Total trades: ${stats.totalTrades}
- Win rate global: ${stats.winRate}%
- P&L total: $${stats.pnlTotal}
- P&L esta semana: $${stats.pnlWeek}
${stats.rachaNegativa ? `⚠️ RACHA NEGATIVA ACTIVA: ${stats.lossStreak} pérdidas recientes` : ''}

RENDIMIENTO POR ÍNDICE:
${indexSummary || '  Sin datos suficientes'}

ÚLTIMAS 10 OPERACIONES:
${recentTrades || '  Sin operaciones registradas'}

ESTRATEGIA:
- Solo Stochastic (5,3,3) — K y D en 1H + 5M + 1M
- Crash: K>80 y D>80 → SELL | Boom: K<20 y D<20 → BUY
- SL: 14 puntos | TP: 28 puntos | RR: 1:2

INSTRUCCIONES:
- Responde SIEMPRE en español
- Sé conciso (máximo 3-4 párrafos)
- Si hay racha negativa, recomienda pausar o reducir riesgo
- Basa tus recomendaciones en los datos reales del trader
- No inventes datos que no están en el contexto
- Si preguntan sobre lotaje: sugiere subir a 0.25 cuando capital ≥ $200, 0.50 cuando ≥ $500`;
}

// ── Bedrock invocation ────────────────────────────────────────────────────────

async function chat(systemPrompt, messages) {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    temperature: 0.7,
    system: systemPrompt,
    messages,
  };

  const cmd = new InvokeModelCommand({
    modelId: BEDROCK_MODEL,
    contentType: 'application/json',
    accept: 'application/json',
    body: Buffer.from(JSON.stringify(body)),
  });

  const resp = await bedrock.send(cmd);
  const raw  = JSON.parse(Buffer.from(resp.body).toString());
  return raw.content?.[0]?.text?.trim() ?? 'Lo siento, no pude generar una respuesta.';
}

// ── POST /copilot ─────────────────────────────────────────────────────────────

async function handleChat(event) {
  const userId = getUserId(event);

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON body'); }

  const { message, history = [] } = body;
  if (!message || typeof message !== 'string') return err('message is required');
  if (message.length > 500) return err('message too long (max 500 chars)');

  console.log(JSON.stringify({ action: 'copilot-chat', userId, msgLen: message.length }));

  // Build context
  const ctx = await buildUserContext(userId);
  const systemPrompt = buildSystemPrompt(ctx);

  // Build messages array (last 10 from history + new message)
  const recentHistory = (history || []).slice(-10).filter(
    m => m.role && m.content && typeof m.content === 'string'
  );
  const messages = [
    ...recentHistory,
    { role: 'user', content: message },
  ];

  const reply = await chat(systemPrompt, messages);

  console.log(JSON.stringify({ action: 'copilot-reply', userId, replyLen: reply.length }));

  return ok({
    reply,
    context: {
      winRate:    ctx.stats.winRate,
      pnlWeek:    ctx.stats.pnlWeek,
      rachaNeg:   ctx.stats.rachaNegativa,
      totalTrades: ctx.stats.totalTrades,
    },
  });
}

// ── GET /copilot/suggestions ──────────────────────────────────────────────────

function handleSuggestions() {
  return ok({
    suggestions: [
      '¿Cómo voy esta semana?',
      '¿Cuándo debo operar hoy?',
      '¿Qué índice me está funcionando mejor?',
      '¿Debo subir el lotaje?',
      '¿Debo pausar el trading hoy?',
      '¿Cuál es mi racha actual?',
    ],
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));
  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    const path   = event.path || '';
    const method = event.httpMethod;

    if (method === 'GET'  && path.endsWith('/suggestions')) return handleSuggestions();
    if (method === 'POST' && !path.includes('/suggestions')) return await handleChat(event);

    return err('Not Found', 404);
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
