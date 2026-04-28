'use strict';

/**
 * SYNTRA 2.0 — signals-api
 * GET /signals        → lista señales (filtros: status, limit)
 * GET /signals/{id}   → detalle señal
 * PATCH /signals/{id} → actualizar resultado (WIN/LOSS)
 */

const { DynamoDBClient, QueryCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client       = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const TABLE        = process.env.DYNAMODB_TABLE_SIGNALS || 'syntra-signals';
const ADMIN_UID    = process.env.ADMIN_USER_ID || 'SYSTEM';

const cors = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
};

const ok  = (body, status = 200) => ({ statusCode: status, headers: cors, body: JSON.stringify(body) });
const err = (msg,  status = 400) => ({ statusCode: status, headers: cors, body: JSON.stringify({ error: msg }) });

// Map DynamoDB item → frontend Signal shape
function mapSignal(raw) {
  return {
    signalId:      raw.timestampSignalId,
    symbol:        raw.symbol,
    indice:        raw.symbol,
    tipo:          raw.tipo,
    direccion:     raw.direccion,
    entrada:       raw.entrada,
    sl:            raw.sl,
    tp:            raw.tp,
    slPuntos:      raw.sl_puntos,
    tpPuntos:      raw.tp_puntos,
    stoch1H:       raw.stoch_1h_k != null ? { k: raw.stoch_1h_k, d: raw.stoch_1h_d } : null,
    stoch5M:       raw.stoch_5m_k != null ? { k: raw.stoch_5m_k, d: raw.stoch_5m_d } : null,
    stoch1M:       raw.stoch_1m_k != null ? { k: raw.stoch_1m_k, d: raw.stoch_1m_d } : null,
    status:        raw.status,
    score:         raw.score,
    finalScore:    raw.score,
    scoreFallback: true,
    resultado:     raw.resultado || null,
    createdAt:     raw.createdAt,
    features:      raw.features || null,
  };
}

// GET /signals
async function getSignals(event) {
  const q      = event.queryStringParameters || {};
  const limit  = Math.min(parseInt(q.limit || '50', 10), 100);

  const params = {
    TableName:                TABLE,
    KeyConditionExpression:   'userId = :uid',
    ExpressionAttributeValues: marshall({ ':uid': ADMIN_UID }),
    ScanIndexForward:          false, // newest first
    Limit:                     limit * 3, // over-fetch to account for filter
  };

  // Status filter — exclude skipped unless explicitly requested
  const statusFilter = q.status;
  if (statusFilter && statusFilter !== 'all') {
    if (statusFilter === 'open') {
      params.FilterExpression = '#st = :st';
      params.ExpressionAttributeNames = { '#st': 'status' };
      params.ExpressionAttributeValues[':st'] = { S: 'open' };
    } else if (statusFilter === 'closed') {
      params.FilterExpression = '#st IN (:w, :l)';
      params.ExpressionAttributeNames = { '#st': 'status' };
      params.ExpressionAttributeValues[':w'] = { S: 'win' };
      params.ExpressionAttributeValues[':l'] = { S: 'loss' };
    }
  } else {
    // Default: exclude skipped and low_score for cleaner UI
    params.FilterExpression = '#st <> :skip AND #st <> :low';
    params.ExpressionAttributeNames = { '#st': 'status' };
    params.ExpressionAttributeValues[':skip'] = { S: 'skipped' };
    params.ExpressionAttributeValues[':low']  = { S: 'low_score' };
  }

  const result  = await client.send(new QueryCommand(params));
  const signals = (result.Items || [])
    .map(item => mapSignal(unmarshall(item)))
    .slice(0, limit);

  console.log(JSON.stringify({ action: 'getSignals', count: signals.length, status: statusFilter || 'all' }));
  return ok({ signals, count: signals.length });
}

// GET /signals/{signalId}
async function getSignalById(event) {
  const signalId = event.pathParameters && event.pathParameters.signalId;
  if (!signalId) return err('signalId required');

  // signalId = timestampSignalId (the SK)
  const result = await client.send(new QueryCommand({
    TableName:                TABLE,
    KeyConditionExpression:   'userId = :uid AND timestampSignalId = :sk',
    ExpressionAttributeValues: marshall({
      ':uid': ADMIN_UID,
      ':sk':  decodeURIComponent(signalId),
    }),
    Limit: 1,
  }));

  if (!result.Items || !result.Items.length) return err('Signal not found', 404);

  return ok(mapSignal(unmarshall(result.Items[0])));
}

// PATCH /signals/{signalId} — mark WIN or LOSS
async function updateSignal(event) {
  const signalId = event.pathParameters && event.pathParameters.signalId;
  if (!signalId) return err('signalId required');

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return err('Invalid JSON'); }

  const resultado = body.resultado;
  if (!['WIN', 'LOSS'].includes(resultado)) return err('resultado must be WIN or LOSS');

  const newStatus = resultado === 'WIN' ? 'win' : 'loss';

  await client.send(new UpdateItemCommand({
    TableName: TABLE,
    Key: marshall({
      userId:            ADMIN_UID,
      timestampSignalId: decodeURIComponent(signalId),
    }),
    UpdateExpression:          'SET #st = :st, resultado = :r, closedAt = :ca',
    ExpressionAttributeNames:  { '#st': 'status' },
    ExpressionAttributeValues: marshall({
      ':st': newStatus,
      ':r':  resultado,
      ':ca': new Date().toISOString(),
    }),
  }));

  console.log(JSON.stringify({ action: 'updateSignal', signalId, resultado, newStatus }));
  return ok({ ok: true, signalId, resultado, status: newStatus });
}

// Router
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));
  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    const hasId = !!(event.pathParameters && event.pathParameters.signalId);

    if (event.httpMethod === 'GET'   && !hasId) return await getSignals(event);
    if (event.httpMethod === 'GET'   &&  hasId) return await getSignalById(event);
    if (event.httpMethod === 'PATCH' &&  hasId) return await updateSignal(event);

    return err('Method Not Allowed', 405);
  } catch (e) {
    console.error(JSON.stringify({ action: 'error', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
