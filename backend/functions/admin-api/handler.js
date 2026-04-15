'use strict';

const { DynamoDBClient, ScanCommand, UpdateItemCommand } = require('@aws-sdk/client-dynamodb');
const {
  CognitoIdentityProviderClient,
  AdminAddUserToGroupCommand,
  AdminRemoveUserFromGroupCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');

const dynamo  = new DynamoDBClient({ region: 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

const USERS_TABLE  = 'syntra-users';
const USER_POOL_ID = process.env.USER_POOL_ID || 'us-east-1_0clKOkutx';
const VALID_PLANS  = ['pro', 'elite', 'free'];
const PAID_GROUPS  = ['pro', 'elite'];

const corsHeaders = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,PATCH,OPTIONS',
};

function ok(body) {
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(body) };
}

function err(msg, status = 400) {
  return { statusCode: status, headers: corsHeaders, body: JSON.stringify({ error: msg }) };
}

// ── Auth guard: verify caller is in 'admin' Cognito group ────────────────────
function isAdmin(event) {
  const claims = event.requestContext?.authorizer?.claims || {};
  const groups = claims['cognito:groups'];
  if (!groups) return false;
  const groupList = Array.isArray(groups) ? groups : groups.split(',');
  return groupList.includes('admin');
}

// ── Full table scan helper ────────────────────────────────────────────────────
async function scanAll(params) {
  const items = [];
  let lastKey;
  do {
    const res = await dynamo.send(new ScanCommand({ ...params, ...(lastKey && { ExclusiveStartKey: lastKey }) }));
    (res.Items || []).forEach(i => items.push(unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}

// ── GET /admin/users ──────────────────────────────────────────────────────────
async function listUsers(event) {
  const q = event.queryStringParameters || {};
  const page  = Math.max(1, parseInt(q.page  || '1',  10));
  const limit = Math.min(100, parseInt(q.limit || '50', 10));

  console.log(JSON.stringify({ action: 'admin_listUsers', page, limit }));

  const users = await scanAll({
    TableName: USERS_TABLE,
    ProjectionExpression: 'userId, email, #plan, plan_expires, plan_source, created_at',
    ExpressionAttributeNames: { '#plan': 'plan' },
  });

  // Sort by created_at desc
  users.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

  const total = users.length;
  const start = (page - 1) * limit;
  const page_items = users.slice(start, start + limit);

  return ok({ users: page_items, total, page, limit, pages: Math.ceil(total / limit) });
}

// ── PATCH /admin/users/{userId}/plan ──────────────────────────────────────────
async function updateUserPlan(event) {
  const targetUserId = event.pathParameters?.userId;
  if (!targetUserId) return err('userId path parameter required');

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch { return err('Invalid JSON body'); }

  const { plan, months } = body;
  if (!plan || !VALID_PLANS.includes(plan)) return err(`plan must be one of: ${VALID_PLANS.join(', ')}`);

  const now = new Date();
  let plan_expires = null;
  if (plan !== 'free') {
    const m = parseInt(months || '1', 10);
    plan_expires = new Date(now.getTime() + m * 30 * 24 * 60 * 60 * 1000).toISOString();
  }

  console.log(JSON.stringify({ action: 'admin_updatePlan', targetUserId, plan, months, plan_expires }));

  // Update DynamoDB
  const setExprs  = ['#plan = :plan', 'plan_source = :src', 'plan_updated_at = :ua'];
  const exprNames = { '#plan': 'plan' };
  const exprVals  = {
    ':plan': { S: plan },
    ':src':  { S: 'admin' },
    ':ua':   { S: now.toISOString() },
  };
  if (plan_expires) {
    setExprs.push('plan_expires = :pe');
    exprVals[':pe'] = { S: plan_expires };
  }

  await dynamo.send(new UpdateItemCommand({
    TableName: USERS_TABLE,
    Key: marshall({ userId: targetUserId }),
    UpdateExpression: `SET ${setExprs.join(', ')}`,
    ExpressionAttributeNames: exprNames,
    ExpressionAttributeValues: exprVals,
  }));

  // Remove from all paid/free Cognito groups first
  for (const g of [...PAID_GROUPS, 'free']) {
    try {
      await cognito.send(new AdminRemoveUserFromGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username:   targetUserId,
        GroupName:  g,
      }));
    } catch (_) { /* ignore if user not in group */ }
  }

  // Add to new group
  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username:   targetUserId,
      GroupName:  plan,
    }));
  } catch (e) {
    console.log(JSON.stringify({ action: 'admin_group_error', targetUserId, plan, error: e.message }));
  }

  console.log(JSON.stringify({ action: 'admin_updatePlan_done', targetUserId, plan, plan_expires }));
  return ok({ userId: targetUserId, plan, plan_expires, updated: true });
}

// ── GET /admin/metrics ────────────────────────────────────────────────────────
async function getMetrics(_event) {
  console.log(JSON.stringify({ action: 'admin_getMetrics' }));

  const users = await scanAll({
    TableName: USERS_TABLE,
    ProjectionExpression: '#plan, created_at',
    ExpressionAttributeNames: { '#plan': 'plan' },
  });

  const by_plan = { free: 0, pro: 0, elite: 0 };
  let new_this_week = 0;
  const weekStart = (() => {
    const d = new Date();
    const day = d.getUTCDay();
    const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff)).toISOString().substring(0, 10);
  })();

  for (const u of users) {
    const plan = u.plan || 'free';
    if (plan in by_plan) by_plan[plan]++;
    else by_plan['free']++;

    const created = (u.created_at || '').substring(0, 10);
    if (created >= weekStart) new_this_week++;
  }

  const mrr_estimate = by_plan.pro * 9 + by_plan.elite * 19;

  return ok({
    total_users: users.length,
    by_plan,
    new_this_week,
    mrr_estimate,
  });
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'request', method: event.httpMethod, path: event.path }));

  try {
    if (event.httpMethod === 'OPTIONS') return ok({});

    // Admin group guard
    if (!isAdmin(event)) {
      console.log(JSON.stringify({ action: 'forbidden', reason: 'not_admin', path: event.path }));
      return err('Forbidden', 403);
    }

    const method = event.httpMethod;
    const path   = event.path || '';

    // GET /admin/metrics
    if (method === 'GET' && path.endsWith('/metrics')) return await getMetrics(event);

    // GET /admin/users
    if (method === 'GET' && path.includes('/users') && !event.pathParameters?.userId) return await listUsers(event);

    // PATCH /admin/users/{userId}/plan
    if (method === 'PATCH' && path.includes('/users/') && path.endsWith('/plan')) return await updateUserPlan(event);

    return err('Not Found', 404);
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    return err('Internal server error', 500);
  }
};
