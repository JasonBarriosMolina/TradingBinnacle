'use strict';

const { DynamoDBClient, GetItemCommand, PutItemCommand, UpdateItemCommand, QueryCommand, ScanCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });

const TRADES_TABLE = 'syntra-trades';
const USERS_TABLE  = 'syntra-users';

const INDEX_CONFIG = [
  'CRASH300N', 'CRASH500N', 'CRASH600N', 'CRASH900N', 'CRASH1000N',
  'BOOM300N',  'BOOM500N',  'BOOM600N',  'BOOM900N',  'BOOM1000N',
];

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
};

function getUserId(event) {
  return event.requestContext.authorizer.claims.sub;
}

function ok(body, status = 200) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify(body) };
}

function err(msg, status = 400) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

// ── GET /trades ──────────────────────────────────────────────────────────────
async function getTrades(event) {
  const userId = getUserId(event);
  const q = event.queryStringParameters || {};
  const limit = Math.min(parseInt(q.limit || '50', 10), 200);

  const filterExprs = ['userId = :uid', 'attribute_not_exists(deleted)'];
  const exprNames  = {};
  const exprValues = { ':uid': { S: userId } };

  if (q.indice) {
    filterExprs.push('#indice = :indice');
    exprNames['#indice'] = 'indice';
    exprValues[':indice'] = { S: q.indice };
  }
  if (q.resultado) {
    filterExprs.push('resultado = :resultado');
    exprValues[':resultado'] = { S: q.resultado };
  }
  if (q.tipo) {
    filterExprs.push('tipo = :tipo');
    exprValues[':tipo'] = { S: q.tipo };
  }
  if (q.desde) {
    filterExprs.push('fecha >= :desde');
    exprValues[':desde'] = { S: q.desde };
  }
  if (q.hasta) {
    filterExprs.push('fecha <= :hasta');
    exprValues[':hasta'] = { S: q.hasta };
  }

  const params = {
    TableName: TRADES_TABLE,
    IndexName: 'userId-fecha-index',
    KeyConditionExpression: 'userId = :uid',
    FilterExpression: filterExprs.slice(1).length
      ? filterExprs.slice(1).join(' AND ')
      : undefined,
    ExpressionAttributeValues: exprValues,
    ScanIndexForward: false,   // desc by fecha
    Limit: limit,
  };

  if (Object.keys(exprNames).length) params.ExpressionAttributeNames = exprNames;
  if (!params.FilterExpression) delete params.FilterExpression;

  // Re-build: KeyConditionExpression handles userId; FilterExpression handles the rest
  const keyExpr = 'userId = :uid';
  const sideFilters = filterExprs.slice(1);
  params.KeyConditionExpression = keyExpr;
  params.FilterExpression = sideFilters.length ? sideFilters.join(' AND ') : undefined;
  if (!params.FilterExpression) delete params.FilterExpression;

  console.log(JSON.stringify({ action: 'getTrades', userId, filters: q }));

  const result = await client.send(new QueryCommand(params));
  const trades = (result.Items || []).map(unmarshall);

  return ok(trades);
}

// ── POST /trades ─────────────────────────────────────────────────────────────
async function createTrade(event) {
  const userId = getUserId(event);
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON body'); }

  const { indice, resultado, entrada, salida, notas, tipo = 'real',
          stoch_1h_k, stoch_1h_d, stoch_5m_k, stoch_5m_d, stoch_1m_k, stoch_1m_d } = body;

  if (!indice) return err('indice is required');
  if (!INDEX_CONFIG.includes(indice)) return err(`indice must be one of: ${INDEX_CONFIG.join(', ')}`);
  if (!tipo || !['real', 'backtest', 'auto'].includes(tipo)) return err('tipo must be real|backtest|auto');

  const tradeId = `trade_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const created_at = new Date().toISOString();
  const fecha = created_at.substring(0, 10); // YYYY-MM-DD

  // Calculate P&L if entrada + salida present
  let pnl = null;
  if (entrada != null && salida != null) {
    let lotaje = 0.01;
    try {
      const userItem = await client.send(new GetItemCommand({
        TableName: USERS_TABLE,
        Key: marshall({ userId }),
      }));
      if (userItem.Item) {
        const user = unmarshall(userItem.Item);
        lotaje = user.lotaje_actual || 0.01;
      }
    } catch (e) {
      console.log(JSON.stringify({ action: 'createTrade_lotaje_warn', userId, error: e.message }));
    }

    const isCrash = indice.startsWith('CRASH');
    pnl = isCrash
      ? (parseFloat(entrada) - parseFloat(salida)) * lotaje * 100000
      : (parseFloat(salida)  - parseFloat(entrada)) * lotaje * 100000;
    pnl = Math.round(pnl * 100) / 100;
  }

  const item = {
    tradeId,
    userId,
    indice,
    tipo,
    fecha,
    created_at,
    ...(resultado   != null && { resultado }),
    ...(entrada     != null && { entrada: parseFloat(entrada) }),
    ...(salida      != null && { salida:  parseFloat(salida)  }),
    ...(pnl         != null && { pnl }),
    ...(notas       != null && { notas }),
    ...(stoch_1h_k  != null && { stoch_1h_k: parseFloat(stoch_1h_k) }),
    ...(stoch_1h_d  != null && { stoch_1h_d: parseFloat(stoch_1h_d) }),
    ...(stoch_5m_k  != null && { stoch_5m_k: parseFloat(stoch_5m_k) }),
    ...(stoch_5m_d  != null && { stoch_5m_d: parseFloat(stoch_5m_d) }),
    ...(stoch_1m_k  != null && { stoch_1m_k: parseFloat(stoch_1m_k) }),
    ...(stoch_1m_d  != null && { stoch_1m_d: parseFloat(stoch_1m_d) }),
  };

  await client.send(new PutItemCommand({
    TableName: TRADES_TABLE,
    Item: marshall(item),
  }));

  console.log(JSON.stringify({ action: 'createTrade', userId, tradeId, indice, tipo, pnl }));
  return ok(item, 201);
}

// ── PATCH /trades/{tradeId} ───────────────────────────────────────────────────
async function updateTrade(event) {
  const userId  = getUserId(event);
  const tradeId = event.pathParameters?.tradeId;
  if (!tradeId) return err('tradeId path parameter required');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON body'); }

  const { resultado, salida, notas } = body;

  // Fetch existing item to get indice + entrada for pnl recalc
  const existing = await client.send(new GetItemCommand({
    TableName: TRADES_TABLE,
    Key: marshall({ tradeId }),
  }));
  if (!existing.Item) return err('Trade not found', 404);

  const trade = unmarshall(existing.Item);
  if (trade.userId !== userId) return err('Forbidden', 403);

  const setExprs = ['updated_at = :ua'];
  const exprValues = { ':ua': { S: new Date().toISOString() } };

  if (resultado !== undefined) {
    setExprs.push('resultado = :res');
    exprValues[':res'] = { S: resultado };
  }
  if (notas !== undefined) {
    setExprs.push('notas = :notas');
    exprValues[':notas'] = { S: notas };
  }
  if (salida !== undefined) {
    setExprs.push('salida = :salida');
    exprValues[':salida'] = { N: String(salida) };

    // Recalculate pnl
    const entrada = trade.entrada;
    if (entrada != null) {
      let lotaje = 0.01;
      try {
        const userItem = await client.send(new GetItemCommand({
          TableName: USERS_TABLE,
          Key: marshall({ userId }),
        }));
        if (userItem.Item) lotaje = unmarshall(userItem.Item).lotaje_actual || 0.01;
      } catch (_) {}

      const isCrash = (trade.indice || '').startsWith('CRASH');
      const pnl = isCrash
        ? (parseFloat(entrada) - parseFloat(salida)) * lotaje * 100000
        : (parseFloat(salida)  - parseFloat(entrada)) * lotaje * 100000;

      setExprs.push('pnl = :pnl');
      exprValues[':pnl'] = { N: String(Math.round(pnl * 100) / 100) };
    }
  }

  await client.send(new UpdateItemCommand({
    TableName: TRADES_TABLE,
    Key: marshall({ tradeId }),
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeValues: exprValues,
  }));

  console.log(JSON.stringify({ action: 'updateTrade', userId, tradeId, fields: Object.keys(body) }));
  return ok({ tradeId, updated: true });
}

// ── DELETE /trades/{tradeId} (soft) ──────────────────────────────────────────
async function deleteTrade(event) {
  const userId  = getUserId(event);
  const tradeId = event.pathParameters?.tradeId;
  if (!tradeId) return err('tradeId path parameter required');

  const existing = await client.send(new GetItemCommand({
    TableName: TRADES_TABLE,
    Key: marshall({ tradeId }),
  }));
  if (!existing.Item) return err('Trade not found', 404);

  const trade = unmarshall(existing.Item);
  if (trade.userId !== userId) return err('Forbidden', 403);

  await client.send(new UpdateItemCommand({
    TableName: TRADES_TABLE,
    Key: marshall({ tradeId }),
    UpdateExpression: 'SET deleted = :t, deleted_at = :da',
    ExpressionAttributeValues: {
      ':t':  { BOOL: true },
      ':da': { S: new Date().toISOString() },
    },
  }));

  console.log(JSON.stringify({ action: 'deleteTrade', userId, tradeId }));
  return ok({ tradeId, deleted: true });
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));

  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    const method = event.httpMethod;
    const hasId   = !!event.pathParameters?.tradeId;

    if (method === 'GET'    && !hasId) return await getTrades(event);
    if (method === 'POST'   && !hasId) return await createTrade(event);
    if (method === 'PATCH'  &&  hasId) return await updateTrade(event);
    if (method === 'DELETE' &&  hasId) return await deleteTrade(event);

    return err('Method Not Allowed', 405);
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
