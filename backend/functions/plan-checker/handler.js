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
const PAID_GROUPS  = ['pro', 'elite'];

// ── Scan for all paid users with expired plan_expires ────────────────────────
async function scanExpiredUsers(now) {
  const expired = [];
  let lastKey;

  do {
    const params = {
      TableName: USERS_TABLE,
      FilterExpression: '#plan <> :free AND plan_expires < :now',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: {
        ':free': { S: 'free' },
        ':now':  { S: now },
      },
      ProjectionExpression: 'userId, #plan, plan_expires, plan_source',
      ...(lastKey && { ExclusiveStartKey: lastKey }),
    };

    const res = await dynamo.send(new ScanCommand(params));
    (res.Items || []).forEach(i => expired.push(unmarshall(i)));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return expired;
}

// ── Downgrade a single user to free ──────────────────────────────────────────
async function downgradeUser(user) {
  const { userId, plan: previousPlan } = user;

  try {
    // Update DynamoDB
    await dynamo.send(new UpdateItemCommand({
      TableName: USERS_TABLE,
      Key: marshall({ userId }),
      UpdateExpression: 'SET #plan = :free, plan_source = :expired, downgraded_at = :da',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: {
        ':free':    { S: 'free' },
        ':expired': { S: 'expired' },
        ':da':      { S: new Date().toISOString() },
      },
    }));

    // Remove from paid group
    if (previousPlan && PAID_GROUPS.includes(previousPlan)) {
      try {
        await cognito.send(new AdminRemoveUserFromGroupCommand({
          UserPoolId: USER_POOL_ID,
          Username:   userId,
          GroupName:  previousPlan,
        }));
      } catch (e) {
        // User may not be in the group — non-fatal
        console.log(JSON.stringify({ action: 'removeGroup_warn', userId, group: previousPlan, error: e.message }));
      }
    }

    // Add to "free" group
    try {
      await cognito.send(new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username:   userId,
        GroupName:  'free',
      }));
    } catch (e) {
      console.log(JSON.stringify({ action: 'addFreeGroup_warn', userId, error: e.message }));
    }

    console.log(JSON.stringify({ action: 'downgraded', userId, previousPlan }));
    return true;
  } catch (e) {
    console.log(JSON.stringify({ action: 'downgrade_error', userId, error: e.message }));
    return false;
  }
}

// ── EventBridge Handler ───────────────────────────────────────────────────────
exports.handler = async (event) => {
  const now = new Date().toISOString();
  console.log(JSON.stringify({ action: 'plan-checker start', triggeredAt: now, event }));

  try {
    const expiredUsers = await scanExpiredUsers(now);
    console.log(JSON.stringify({ action: 'scan_complete', expiredCount: expiredUsers.length }));

    if (expiredUsers.length === 0) {
      console.log(JSON.stringify({ action: 'plan-checker done', downgraded: 0 }));
      return { downgraded: 0 };
    }

    // Process in parallel batches of 10 to avoid throttling
    let downgraded = 0;
    const batchSize = 10;
    for (let i = 0; i < expiredUsers.length; i += batchSize) {
      const batch   = expiredUsers.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(downgradeUser));
      downgraded   += results.filter(Boolean).length;
    }

    // Telegram notification stub — log for now
    console.log(JSON.stringify({
      action: 'telegram_stub',
      message: `SYNTRA plan-checker: ${downgraded} user(s) downgraded to free at ${now}`,
    }));

    console.log(JSON.stringify({ action: 'plan-checker done', downgraded, total_expired: expiredUsers.length }));
    return { downgraded, total_expired: expiredUsers.length };
  } catch (e) {
    console.log(JSON.stringify({ action: 'unhandledError', error: e.message, stack: e.stack }));
    throw e;
  }
};
