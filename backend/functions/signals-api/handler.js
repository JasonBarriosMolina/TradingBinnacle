'use strict';

const { DynamoDBClient, GetItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const client = new DynamoDBClient({ region: 'us-east-1' });

const SIGNALS_TABLE = 'syntra-signals';
const USERS_TABLE   = 'syntra-users';

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
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

// ── GET /signals ──────────────────────────────────────────────────────────────
async function getSignals(event) {
  const userId = getUserId(event);
  const q = event.queryStringParameters || {};

  // Determine limit based on user plan
  let maxLimit = 50;
  try {
    const userItem = await client.send(new GetItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId }),
    }));
    if (userItem.Item) {
      const user = unmarshall(userItem.Item);
      const plan = user.plan || 'free';
      // Free plan: last 10 signals only
      if (plan === 'free') maxLimit = 10;
    }
  } catch (e) {
    console.log(JSON.stringify({ action: 'getSignals_plan_warn', userId, error: e.message }));
  }

  const params = {
    TableName: SIGNALS_TABLE,
    IndexName: 'userId-created_at-index',
    KeyConditionExpression: 'userId = :uid',
    ExpressionAttributeValues: { ':uid': { S: userId } },
    ScanIndexForward: false,
    Limit: maxLimit,
  };

  // Optional status filter
  if (q.status && ['open', 'win', 'loss', 'skipped'].includes(q.status)) {
    params.FilterExpression = '#st = :status';
    params.ExpressionAttributeNames = { '#st': 'status' };
    params.ExpressionAttributeValues[':status'] = { S: q.status };
  }

  console.log(JSON.stringify({ action: 'getSignals', userId, status: q.status || 'all', maxLimit }));

  const result = await client.send(new QueryCommand(params));
  const signals = (result.Items || []).map(item => {
    const s = unmarshall(item);
    // Strip heavy nested fields for list view
    const { score_breakdown, tick_snapshot, features, ...rest } = s;
    // Normalize: map backend field names to camelCase for frontend
    return {
      ...rest,
      indice:         rest.symbol || rest.indice,
      createdAt:      rest.created_at || rest.createdAt,
      finalScore:     rest.final_score,
      sagemakerScore: rest.sagemaker_score ?? null,
      bedrockScore:   rest.bedrock_score   ?? null,
      journalScore:   rest.journal_score   ?? null,
      scoreFallback:  rest.score_fallback  ?? true,
      scoreReason:    rest.score_reason    ?? null,
      slPuntos:       rest.sl_points,
      tpPuntos:       rest.tp_points,
      stoch1H: rest.stoch_1h_k != null
        ? { k: rest.stoch_1h_k, d: rest.stoch_1h_d }
        : rest.stoch1H,
      stoch5M: rest.stoch_5m_k != null
        ? { k: rest.stoch_5m_k, d: rest.stoch_5m_d }
        : rest.stoch5M,
      stoch1M: rest.stoch_1m_k != null
        ? { k: rest.stoch_1m_k, d: rest.stoch_1m_d }
        : rest.stoch1M ?? null,
    };
  });

  return ok({ signals, count: signals.length, plan_limit: maxLimit });
}

// ── GET /signals/{signalId} ───────────────────────────────────────────────────
async function getSignal(event) {
  const userId   = getUserId(event);
  const signalId = event.pathParameters?.signalId;
  if (!signalId) return err('signalId path parameter required');

  const result = await client.send(new GetItemCommand({
    TableName: SIGNALS_TABLE,
    Key: marshall({ signalId }),
  }));

  if (!result.Item) return err('Signal not found', 404);

  const signal = unmarshall(result.Item);
  if (signal.userId !== userId) return err('Forbidden', 403);

  console.log(JSON.stringify({ action: 'getSignal', userId, signalId }));

  // Return full signal including score_breakdown and tick_snapshot
  return ok(signal);
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));

  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    const method  = event.httpMethod;
    const hasId   = !!event.pathParameters?.signalId;

    if (method === 'GET' && !hasId) return await getSignals(event);
    if (method === 'GET' &&  hasId) return await getSignal(event);

    return err('Method Not Allowed', 405);
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
