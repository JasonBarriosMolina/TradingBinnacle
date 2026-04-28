'use strict';

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });

const TRADES_TABLE = 'syntra-trades';
const USERS_TABLE  = 'syntra-users';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

function getUserId(event) {
  return event.requestContext.authorizer.claims.sub;
}

function ok(body) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) };
}

function err(msg, status = 400) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

// Fetch all non-deleted trades for a user (unbounded scan via GSI)
async function fetchAllTrades(userId) {
  const trades = [];
  let lastKey;

  do {
    const params = {
      TableName: TRADES_TABLE,
      IndexName: 'userId-fecha-index',
      KeyConditionExpression: 'userId = :uid',
      FilterExpression: 'attribute_not_exists(deleted)',
      ExpressionAttributeValues: { ':uid': { S: userId } },
      ScanIndexForward: false,
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    };
    const res = await client.send(new QueryCommand(params));
    (res.Items || []).forEach(i => trades.push(unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return trades;
}

// ISO date string → YYYY-MM-DD
function toDateStr(isoOrDate) {
  return typeof isoOrDate === 'string'
    ? isoOrDate.substring(0, 10)
    : new Date(isoOrDate).toISOString().substring(0, 10);
}

function getWeekStart() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1); // Mon
  const mon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), diff));
  return mon.toISOString().substring(0, 10);
}

// ── GET /stats ────────────────────────────────────────────────────────────────
async function getStats(event) {
  const userId = getUserId(event);
  console.log(JSON.stringify({ action: 'getStats', userId }));

  const [trades, userItem] = await Promise.all([
    fetchAllTrades(userId),
    client.send(new GetItemCommand({ TableName: USERS_TABLE, Key: marshall({ userId }) })),
  ]);

  const user = userItem.Item ? unmarshall(userItem.Item) : {};

  const weekStart = getWeekStart();
  let wins = 0, pnl_total = 0, pnl_semana = 0, rr_sum = 0, rr_count = 0;
  const por_indice = {};

  // Streak tracking (trades are already desc by fecha — reverse for chronological order)
  const chronological = [...trades].reverse();
  let racha_actual = { tipo: 'win', count: 0 };
  let racha_negativa = false;

  for (const t of chronological) {
    if (!t.resultado) continue; // skip open/no result
    const isWin = t.resultado === 'win';
    if (racha_actual.count === 0) {
      racha_actual = { tipo: isWin ? 'win' : 'loss', count: 1 };
    } else if ((racha_actual.tipo === 'win') === isWin) {
      racha_actual.count++;
    } else {
      racha_actual = { tipo: isWin ? 'win' : 'loss', count: 1 };
    }
  }
  // Check last 3 results for racha_negativa
  const lastResults = chronological
    .filter(t => t.resultado)
    .slice(-3)
    .map(t => t.resultado);
  racha_negativa = lastResults.length === 3 && lastResults.every(r => r === 'loss');

  // Aggregate stats
  for (const t of trades) {
    const indice = t.indice || 'UNKNOWN';
    if (!por_indice[indice]) por_indice[indice] = { trades: 0, wins: 0, win_rate: 0, pnl: 0 };

    por_indice[indice].trades++;

    const pnl = typeof t.pnl === 'number' ? t.pnl : 0;
    pnl_total += pnl;
    por_indice[indice].pnl += pnl;

    const fecha = t.fecha || toDateStr(t.created_at || Date.now());
    if (fecha >= weekStart) pnl_semana += pnl;

    if (t.resultado === 'win') {
      wins++;
      por_indice[indice].wins++;
    }

    // R:R — only if entrada, salida, and stop_loss present
    if (t.entrada != null && t.salida != null && t.stop_loss != null) {
      const reward = Math.abs(t.salida - t.entrada);
      const risk   = Math.abs(t.entrada - t.stop_loss);
      if (risk > 0) { rr_sum += reward / risk; rr_count++; }
    }
  }

  // Finalize por_indice win rates
  for (const sym of Object.keys(por_indice)) {
    const g = por_indice[sym];
    g.win_rate = g.trades > 0 ? Math.round((g.wins / g.trades) * 100) : 0;
    g.pnl = Math.round(g.pnl * 100) / 100;
  }

  const total_trades   = trades.length;
  const win_rate       = total_trades > 0 ? Math.round((wins / total_trades) * 100) : 0;
  const rr_promedio    = rr_count > 0 ? Math.round((rr_sum / rr_count) * 100) / 100 : null;
  const capital_inicial = user.capital_inicial || 0;
  const capital_actual  = Math.round((capital_inicial + pnl_total) * 100) / 100;

  // Lotaje recommendation
  let lotaje_recomendado = null;
  const current_lot = user.lotaje_actual || 0.01;
  if (capital_actual >= 200  && current_lot < 0.25) lotaje_recomendado = 'Sube a 0.25 cuando llegues a $200';
  if (capital_actual >= 500  && current_lot < 0.50) lotaje_recomendado = 'Sube a 0.50 cuando llegues a $500';
  if (capital_actual >= 1000 && current_lot < 1.00) lotaje_recomendado = 'Sube a 1.00 cuando llegues a $1,000';

  const losses = total_trades - wins;

  return ok({
    // camelCase for frontend compatibility
    totalTrades:     total_trades,
    wins,
    losses,
    winRate:         win_rate,
    pnlWeek:         Math.round(pnl_semana * 100) / 100,
    pnlTotal:        Math.round(pnl_total  * 100) / 100,
    rrPromedio:      rr_promedio,
    capital:         capital_actual,
    rachaActual:     racha_actual.count * (racha_actual.tipo === 'win' ? 1 : -1),
    rachaPositiva:   racha_actual.tipo === 'win' ? racha_actual.count : 0,
    rachaNegativa:   racha_negativa,
    porIndice:       por_indice,
    lotajeSugerido:  user.lotaje_actual || 0.01,
    lotajeMsg:       lotaje_recomendado,
  });
}

// ── GET /stats/equity ─────────────────────────────────────────────────────────
async function getEquity(event) {
  const userId = getUserId(event);
  console.log(JSON.stringify({ action: 'getEquity', userId }));

  const trades = await fetchAllTrades(userId);

  // Build a map of date → daily pnl
  const dailyMap = {};
  for (const t of trades) {
    const fecha = t.fecha || toDateStr(t.created_at || Date.now());
    if (!dailyMap[fecha]) dailyMap[fecha] = 0;
    dailyMap[fecha] += typeof t.pnl === 'number' ? t.pnl : 0;
  }

  // Generate last 30 calendar days
  const result = [];
  let acumulado = 0;
  const today = new Date();

  for (let i = 29; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const fecha = d.toISOString().substring(0, 10);
    const pnl = Math.round((dailyMap[fecha] || 0) * 100) / 100;
    acumulado = Math.round((acumulado + pnl) * 100) / 100;
    result.push({ fecha, pnl, acumulado });
  }

  // Map to camelCase for frontend
  return ok({ points: result.map(p => ({ fecha: p.fecha, pnl: p.pnl, cumulative: p.acumulado })) });
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));

  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    const path   = event.path || '';
    const method = event.httpMethod;

    if (method === 'GET' && path.endsWith('/equity')) return await getEquity(event);
    if (method === 'GET') return await getStats(event);

    return err('Method Not Allowed', 405);
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
