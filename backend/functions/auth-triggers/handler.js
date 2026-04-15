'use strict';

const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } = require('@aws-sdk/client-cognito-identity-provider');
const { marshall } = require('@aws-sdk/util-dynamodb');

const dynamo  = new DynamoDBClient({ region: 'us-east-1' });
const cognito = new CognitoIdentityProviderClient({ region: 'us-east-1' });

const USERS_TABLE   = 'syntra-users';
const USER_POOL_ID  = process.env.USER_POOL_ID || 'us-east-1_0clKOkutx';

// ── Pre Sign-Up ───────────────────────────────────────────────────────────────
// Auto-confirm user and mark email as verified (simplifies dev/onboarding flow)
async function preSignUp(event) {
  console.log(JSON.stringify({ trigger: 'preSignUp', userName: event.userName }));

  event.response.autoConfirmUser   = true;
  event.response.autoVerifyEmail   = true;
  event.response.autoVerifyPhone   = false;

  return event;
}

// ── Post Confirmation ─────────────────────────────────────────────────────────
// Create the user record in DynamoDB and add to Cognito "pro" group (7-day trial)
async function postConfirmation(event) {
  const { userName, request: { userAttributes } } = event;
  const email = userAttributes.email;

  console.log(JSON.stringify({ trigger: 'postConfirmation', userName, email }));

  const now         = new Date();
  const plan_expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const sinpe_ref   = `syntra-${userName.substring(0, 8)}`;

  const userRecord = {
    userId:           userName,
    email,
    plan:             'pro',
    plan_source:      'trial',
    plan_expires,
    sinpe_ref,
    lotaje_actual:    0.01,
    capital_inicial:  0,
    indices_activos:  ['CRASH300N', 'CRASH500N', 'BOOM300N', 'BOOM500N'],
    score_min_entry:  65,
    created_at:       now.toISOString(),
  };

  // Write user to DynamoDB
  try {
    await dynamo.send(new PutItemCommand({
      TableName: USERS_TABLE,
      Item: marshall(userRecord),
      ConditionExpression: 'attribute_not_exists(userId)', // idempotent guard
    }));
    console.log(JSON.stringify({ trigger: 'postConfirmation', action: 'dynamo_ok', userName }));
  } catch (e) {
    if (e.name === 'ConditionalCheckFailedException') {
      console.log(JSON.stringify({ trigger: 'postConfirmation', action: 'dynamo_already_exists', userName }));
    } else {
      console.log(JSON.stringify({ trigger: 'postConfirmation', action: 'dynamo_error', userName, error: e.message }));
      throw e; // surface to Cognito so confirmation is retried
    }
  }

  // Add user to "pro" Cognito group
  try {
    await cognito.send(new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username:   userName,
      GroupName:  'pro',
    }));
    console.log(JSON.stringify({ trigger: 'postConfirmation', action: 'group_ok', userName, group: 'pro' }));
  } catch (e) {
    // Non-fatal: user record is already created, group assignment can be retried
    console.log(JSON.stringify({ trigger: 'postConfirmation', action: 'group_error', userName, error: e.message }));
  }

  return event;
}

// ── Router ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ trigger: event.triggerSource, userName: event.userName }));

  try {
    switch (event.triggerSource) {
      case 'PreSignUp_SignUp':
      case 'PreSignUp_AdminCreateUser':
      case 'PreSignUp_ExternalProvider':
        return await preSignUp(event);

      case 'PostConfirmation_ConfirmSignUp':
      case 'PostConfirmation_ConfirmForgotPassword':
        return await postConfirmation(event);

      default:
        console.log(JSON.stringify({ trigger: 'unknown', source: event.triggerSource }));
        return event; // pass-through unknown triggers
    }
  } catch (e) {
    console.log(JSON.stringify({ trigger: 'unhandledError', error: e.message, stack: e.stack }));
    throw e; // Cognito requires throws to surface errors
  }
};
