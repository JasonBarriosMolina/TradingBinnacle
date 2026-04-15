'use strict';
/**
 * SYNTRA 2.0 — step-orchestrator
 *
 * Orchestrates the full signal pipeline (invoked async by signal-worker):
 *
 *   1. Anti-duplicate check — skip if same symbol had signal in last 30 min
 *   2. Feature engine    — calculate all 20+ ML features
 *   3. ML scorer         — score 0-100 (fallback: stoch quality score)
 *   4. Score gate        — skip if score < SCORE_MIN_ENTRY
 *   5. Persist signal    — save to syntra-signals DynamoDB table
 *   6. Notify            — Telegram bot + SNS
 *
 * Runs as a synchronous Lambda (not actual AWS Step Functions yet — Phase 4).
 */

const { DynamoDBClient, PutItemCommand, QueryCommand } = require('@aws-sdk/client-dynamodb');
const { marshall, unmarshall } = require('@aws-sdk/util-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

const dynamo    = new DynamoDBClient({ region: 'us-east-1' });
const lambda    = new LambdaClient({ region: 'us-east-1' });
const sns       = new SNSClient({ region: 'us-east-1' });

const SIGNALS_TABLE  = process.env.DYNAMODB_TABLE_SIGNALS  || 'syntra-signals';
const USERS_TABLE    = process.env.DYNAMODB_TABLE_USERS    || 'syntra-users';
const SCORE_MIN      = parseInt(process.env.SCORE_MIN_ENTRY || '65', 10);
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const FUNCTION_BASE  = (process.env.AWS_LAMBDA_FUNCTION_NAME || 'syntra-backend-dev-step-orchestrator')
  .replace('step-orchestrator', '');

const ANTI_DUP_MINUTES = 30;

// ── Helpers ──────────────────────────────────────────────────────────────────

function signalId() {
  return `sig_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
}

/**
 * Check if same symbol already triggered a signal in the last 30 minutes.
 * Queries a global signal log key (symbol-level, not user-level) stored in
 * the first row of syntra-signals with userId='_system'.
 */
async function checkAntiDuplicate(symbol) {
  const cutoff = new Date(Date.now() - ANTI_DUP_MINUTES * 60 * 1000).toISOString();

  const result = await dynamo.send(new QueryCommand({
    TableName: SIGNALS_TABLE,
    IndexName: 'symbol-created_at-index',
    KeyConditionExpression: '#sym = :sym AND created_at > :cutoff',
    ExpressionAttributeNames: { '#sym': 'symbol' },
    ExpressionAttributeValues: {
      ':sym':    { S: symbol },
      ':cutoff': { S: cutoff },
    },
    Limit: 1,
  }));

  return (result.Items || []).length > 0;
}

/**
 * Invokes feature-engine Lambda synchronously to get enriched features.
 */
async function invokeFeatureEngine(payload) {
  const fnName = `${FUNCTION_BASE}feature-engine`;
  try {
    const resp = await lambda.send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify(payload)),
    }));
    const body = JSON.parse(Buffer.from(resp.Payload).toString());
    return body?.features || {};
  } catch (e) {
    console.log(JSON.stringify({ action: 'featureEngineWarn', error: e.message }));
    return payload.features || {};  // fallback to stoch features only
  }
}

/**
 * Invokes ml-scorer Lambda synchronously.
 */
async function invokeMLScorer(features, symbol) {
  const fnName = `${FUNCTION_BASE}ml-scorer`;
  try {
    const resp = await lambda.send(new InvokeCommand({
      FunctionName: fnName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ features, symbol })),
    }));
    return JSON.parse(Buffer.from(resp.Payload).toString());
  } catch (e) {
    console.log(JSON.stringify({ action: 'mlScorerWarn', error: e.message }));
    return { final_score: 50, fallback: true, reason: 'ML scorer error' };
  }
}

/**
 * Sends Telegram message to a specific chat_id.
 */
async function sendTelegram(chatId, text) {
  if (!TELEGRAM_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
    });
  } catch (e) {
    console.log(JSON.stringify({ action: 'telegramWarn', chatId, error: e.message }));
  }
}

/**
 * Formats signal notification text for Telegram.
 */
function formatTelegramMsg(signal, scoreResult) {
  const emoji  = signal.direction === 'SELL' ? '🔴' : '🟢';
  const dir    = signal.direction === 'SELL' ? 'SELL (Crash)' : 'BUY (Boom)';
  const score  = scoreResult.final_score?.toFixed(0) ?? '?';
  const fb     = scoreResult.fallback ? ' <i>(fallback)</i>' : '';

  return `${emoji} <b>SYNTRA 2.0 — Nueva Señal</b>

📊 <b>${signal.symbol}</b> — ${dir}
💹 Entrada: <code>${signal.entrada}</code>
🛑 SL: <code>${signal.sl}</code> (${signal.sl_points} pts)
🎯 TP: <code>${signal.tp}</code> (${signal.tp_points} pts)

📈 Stoch 1H: K=${signal.stoch1H.k.toFixed(1)} / D=${signal.stoch1H.d.toFixed(1)}
📈 Stoch 5M: K=${signal.stoch5M.k.toFixed(1)} / D=${signal.stoch5M.d.toFixed(1)}${
  signal.stoch1M
    ? `\n📈 Stoch 1M: K=${signal.stoch1M.k.toFixed(1)} / D=${signal.stoch1M.d.toFixed(1)}`
    : ''
}

🤖 Score ML: <b>${score}/100</b>${fb}
⏰ ${new Date().toLocaleString('es-CR', { timeZone: 'America/Costa_Rica' })} (CR)

<i>Abre SYNTRA → Señales para registrar resultado</i>`;
}

/**
 * Saves signal to DynamoDB syntra-signals table.
 * Uses userId='_broadcast' for system-level signals (sent to all pro+ users).
 */
async function saveSignal(signalData) {
  await dynamo.send(new PutItemCommand({
    TableName: SIGNALS_TABLE,
    Item: marshall(signalData, { removeUndefinedValues: true }),
  }));
}

/**
 * Fetches all pro/elite users who have this symbol active + telegram configured.
 */
async function getEligibleUsers(symbol) {
  // Full scan is expensive but users table is small. In production,
  // add a GSI on plan + active_symbols for efficiency.
  const { ScanCommand } = require('@aws-sdk/client-dynamodb');
  try {
    const result = await dynamo.send(new ScanCommand({
      TableName: USERS_TABLE,
      FilterExpression: '(#plan = :pro OR #plan = :elite) AND contains(indices_activos, :sym)',
      ExpressionAttributeNames: { '#plan': 'plan' },
      ExpressionAttributeValues: {
        ':pro':   { S: 'pro' },
        ':elite': { S: 'elite' },
        ':sym':   { S: symbol },
      },
    }));
    return (result.Items || []).map(i => unmarshall(i));
  } catch (e) {
    console.log(JSON.stringify({ action: 'getUsersWarn', error: e.message }));
    return [];
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const {
    symbol,
    direction,
    type,
    entrada,
    sl,
    tp,
    sl_points,
    tp_points,
    stoch1H,
    stoch5M,
    stoch1M,
    features: stochFeatures,
    timestamp,
  } = event;

  console.log(JSON.stringify({ action: 'orchestrator-start', symbol, direction, entrada }));

  // ── Step 1: Anti-duplicate ──────────────────────────────────────────────────
  let isDuplicate = false;
  try {
    isDuplicate = await checkAntiDuplicate(symbol);
  } catch (e) {
    // Index might not exist yet — treat as non-duplicate and continue
    console.log(JSON.stringify({ action: 'antiDupWarn', error: e.message }));
  }

  if (isDuplicate) {
    console.log(JSON.stringify({ action: 'signal-skipped-duplicate', symbol }));
    return { status: 'duplicate', symbol };
  }

  // ── Step 2: Feature engine ──────────────────────────────────────────────────
  const enrichedFeatures = await invokeFeatureEngine({
    symbol, timestamp, entrada, features: stochFeatures,
  });

  // ── Step 3: ML scorer ───────────────────────────────────────────────────────
  const scoreResult = await invokeMLScorer(enrichedFeatures, symbol);
  const finalScore = scoreResult.final_score ?? 50;

  const sigId      = signalId();
  const createdAt  = timestamp || new Date().toISOString();
  const status     = finalScore >= SCORE_MIN ? 'open' : 'skipped';

  // ── Step 4: Persist signal ──────────────────────────────────────────────────
  const signalRecord = {
    signalId:   sigId,
    symbol,
    // Store with userId='_broadcast' to allow per-user copies in notify step
    userId:     '_broadcast',
    direction,
    type,
    entrada,
    sl,
    tp,
    sl_points,
    tp_points,
    stoch_1h_k: stoch1H.k,
    stoch_1h_d: stoch1H.d,
    stoch_5m_k: stoch5M.k,
    stoch_5m_d: stoch5M.d,
    ...(stoch1M && { stoch_1m_k: stoch1M.k, stoch_1m_d: stoch1M.d }),
    sagemaker_score: scoreResult.sagemaker_score ?? null,
    bedrock_score:   scoreResult.bedrock_score   ?? null,
    journal_score:   scoreResult.journal_score   ?? null,
    final_score:     finalScore,
    score_fallback:  scoreResult.fallback ?? true,
    score_reason:    scoreResult.reason   ?? null,
    status,
    created_at: createdAt,
    features:   JSON.stringify(enrichedFeatures),
  };

  await saveSignal(signalRecord);
  console.log(JSON.stringify({ action: 'signal-saved', symbol, signalId: sigId, status, score: finalScore }));

  // ── Step 5: Notify (only if score >= threshold) ─────────────────────────────
  if (status === 'open') {
    // Get eligible users (pro/elite with this index active)
    const users = await getEligibleUsers(symbol);

    // Save per-user copies so /signals page works per user
    const userSignalPromises = users.map(async (user) => {
      const userSignal = {
        ...signalRecord,
        userId:  user.userId,
        // Create unique PK per user
        signalId: `${sigId}_${user.userId}`,
      };
      try {
        await saveSignal(userSignal);
      } catch (e) {
        console.log(JSON.stringify({ action: 'userSignalSaveWarn', userId: user.userId, error: e.message }));
      }

      // Send Telegram if configured
      if (user.telegram_chat_id) {
        const msg = formatTelegramMsg({ symbol, direction, entrada, sl, tp, sl_points, tp_points, stoch1H, stoch5M, stoch1M }, scoreResult);
        await sendTelegram(user.telegram_chat_id, msg);
      }
    });

    await Promise.all(userSignalPromises);

    // Publish to SNS topic for any future subscribers (web push, etc.)
    if (process.env.SNS_SIGNALS_ARN) {
      try {
        await sns.send(new PublishCommand({
          TopicArn: process.env.SNS_SIGNALS_ARN,
          Message: JSON.stringify({ symbol, direction, score: finalScore, signalId: sigId }),
          Subject: `SYNTRA Signal — ${symbol} ${direction}`,
        }));
      } catch (e) {
        console.log(JSON.stringify({ action: 'snsWarn', error: e.message }));
      }
    }

    console.log(JSON.stringify({
      action: 'signal-notified',
      symbol,
      signalId: sigId,
      score: finalScore,
      usersNotified: users.length,
    }));
  } else {
    console.log(JSON.stringify({
      action: 'signal-below-threshold',
      symbol,
      score: finalScore,
      threshold: SCORE_MIN,
    }));
  }

  return {
    status,
    symbol,
    signalId: sigId,
    score:    finalScore,
    notified: status === 'open',
  };
};
