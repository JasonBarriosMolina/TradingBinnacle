'use strict';
/**
 * SYNTRA 2.0 — signal-worker
 *
 * Triggered by EventBridge every 5 min (06:00-24:00 CR time).
 * For each active index: fetches candles from Deriv API, calculates
 * Stoch(5,3,3) K and D on 1H + 5M + 1M, checks entry condition per
 * INDEX_CONFIG, then invokes the step-orchestrator Lambda.
 *
 * Layer path in Lambda runtime: /opt/nodejs/index.js
 */

const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
// Stoch calculator from Lambda Layer (mounted at /opt/nodejs/ in Lambda runtime)
const stochCalc = require('/opt/nodejs/index');

const lambdaClient = new LambdaClient({ region: 'us-east-1' });

// Map our internal symbol names to Deriv API symbols
const DERIV_SYMBOL_MAP = {
  CRASH300N:  'CRASH_300',
  CRASH500N:  'CRASH_500',
  CRASH600N:  'CRASH_600',
  CRASH900N:  'CRASH_900',
  CRASH1000N: 'CRASH_1000',
  BOOM300N:   'BOOM_300',
  BOOM500N:   'BOOM_500',
  BOOM600N:   'BOOM_600',
  BOOM900N:   'BOOM_900',
  BOOM1000N:  'BOOM_1000',
};

// Local copy of INDEX_CONFIG (Layer doesn't export it, only stoch functions)
const INDEX_CFG = {
  CRASH300N:  { type: 'crash', direction: 'SELL', require_1m: false, stoch_entry: { k: 80, d: 80 }, sl_points: 14, tp_points: 28 },
  CRASH500N:  { type: 'crash', direction: 'SELL', require_1m: false, stoch_entry: { k: 80, d: 80 }, sl_points: 14, tp_points: 28 },
  CRASH600N:  { type: 'crash', direction: 'SELL', require_1m: true,  stoch_entry: { k: 80, d: 80 }, sl_points: 14, tp_points: 28 },
  CRASH900N:  { type: 'crash', direction: 'SELL', require_1m: true,  stoch_entry: { k: 80, d: 80 }, sl_points: 14, tp_points: 28 },
  CRASH1000N: { type: 'crash', direction: 'SELL', require_1m: false, stoch_entry: { k: 80, d: 80 }, sl_points: 14, tp_points: 28 },
  BOOM300N:   { type: 'boom',  direction: 'BUY',  require_1m: false, stoch_entry: { k: 20, d: 20 }, sl_points: 14, tp_points: 28 },
  BOOM500N:   { type: 'boom',  direction: 'BUY',  require_1m: false, stoch_entry: { k: 20, d: 20 }, sl_points: 14, tp_points: 28 },
  BOOM600N:   { type: 'boom',  direction: 'BUY',  require_1m: true,  stoch_entry: { k: 20, d: 20 }, sl_points: 14, tp_points: 28 },
  BOOM900N:   { type: 'boom',  direction: 'BUY',  require_1m: true,  stoch_entry: { k: 20, d: 20 }, sl_points: 14, tp_points: 28 },
  BOOM1000N:  { type: 'boom',  direction: 'BUY',  require_1m: false, stoch_entry: { k: 20, d: 20 }, sl_points: 14, tp_points: 28 },
};

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';  // fallback to default public app_id
const CANDLE_COUNT = 50;  // enough for stoch calculation + buffer

/**
 * Fetches candle data from Deriv via WebSocket.
 * Uses a one-shot promise pattern: connect → request → collect → disconnect.
 *
 * @param {string} derivSymbol — e.g. 'CRASH_300'
 * @param {number} granularity — 3600 | 300 | 60
 * @returns {Promise<Array<{high,low,close,open,epoch}>>}
 */
async function fetchCandles(derivSymbol, granularity) {
  return new Promise((resolve, reject) => {
    const wsUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
    let ws;

    try {
      // ws package must be bundled with the Lambda (see backend/package.json)
      const WebSocket = require('ws');
      ws = new WebSocket(wsUrl);

      const timeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) ws.close();
        reject(new Error(`Timeout fetching ${derivSymbol} granularity=${granularity}`));
      }, 15000);

      ws.on('open', () => {
        ws.send(JSON.stringify({
          ticks_history: derivSymbol,
          adjust_start_time: 1,
          count: CANDLE_COUNT,
          end: 'latest',
          granularity,
          start: 1,
          style: 'candles',
        }));
      });

      ws.on('message', (data) => {
        clearTimeout(timeout);
        try {
          const msg = JSON.parse(data.toString());
          ws.close();
          if (msg.error) {
            reject(new Error(`Deriv API error: ${msg.error.message} (${derivSymbol})`));
            return;
          }
          if (msg.candles && Array.isArray(msg.candles)) {
            resolve(msg.candles.map(c => ({
              high:  parseFloat(c.high),
              low:   parseFloat(c.low),
              close: parseFloat(c.close),
              open:  parseFloat(c.open),
              epoch: c.epoch,
            })));
          } else {
            reject(new Error(`No candle data for ${derivSymbol}`));
          }
        } catch (e) {
          ws.close();
          reject(e);
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket error for ${derivSymbol}: ${err.message}`));
      });

    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Fetches all required candle sets for a symbol (1H + 5M + optionally 1M).
 *
 * @param {string} symbol — internal symbol (e.g. CRASH300N)
 * @param {boolean} require1M
 * @returns {Promise<{candles1H, candles5M, candles1M, currentPrice}>}
 */
async function fetchSymbolCandles(symbol, require1M) {
  const derivSymbol = DERIV_SYMBOL_MAP[symbol];

  const promises = [
    fetchCandles(derivSymbol, 3600),  // 1H
    fetchCandles(derivSymbol, 300),   // 5M
  ];
  if (require1M) {
    promises.push(fetchCandles(derivSymbol, 60));  // 1M
  }

  const results = await Promise.all(promises);
  const candles1H = results[0];
  const candles5M = results[1];
  const candles1M = require1M ? results[2] : null;

  // Current price = close of most recent 1M or 5M candle
  const latest5M = candles5M[candles5M.length - 1];
  const currentPrice = latest5M?.close ?? null;

  return { candles1H, candles5M, candles1M, currentPrice };
}

/**
 * Processes a single symbol: fetches candles, computes stoch, checks condition.
 * If condition met, invokes step-orchestrator Lambda asynchronously.
 *
 * @param {string} symbol
 * @returns {Promise<{symbol, triggered: boolean, reason: string}>}
 */
async function processSymbol(symbol) {
  const cfg = INDEX_CFG[symbol];
  if (!cfg) return { symbol, triggered: false, reason: 'No config' };

  let candles1H, candles5M, candles1M, currentPrice;
  try {
    ({ candles1H, candles5M, candles1M, currentPrice } = await fetchSymbolCandles(symbol, cfg.require_1m));
  } catch (e) {
    console.log(JSON.stringify({ action: 'fetchError', symbol, error: e.message }));
    return { symbol, triggered: false, reason: `Fetch error: ${e.message}` };
  }

  // Calculate Stoch K and D using Layer functions
  const stoch1H = stochCalc.getLastStoch(candles1H);
  const stoch5M  = stochCalc.getLastStoch(candles5M);
  const stoch1M  = candles1M ? stochCalc.getLastStoch(candles1M) : null;

  if (!stoch1H || !stoch5M) {
    return { symbol, triggered: false, reason: 'Insufficient candle data for stoch calc' };
  }

  // Check entry condition
  const { valid, reason } = stochCalc.checkEntryCondition(stoch1H, stoch5M, stoch1M, cfg.type, cfg.require_1m);

  console.log(JSON.stringify({
    action: 'stochCheck',
    symbol,
    stoch1H: { k: stoch1H.k, d: stoch1H.d },
    stoch5M:  { k: stoch5M.k,  d: stoch5M.d  },
    stoch1M:  stoch1M ? { k: stoch1M.k, d: stoch1M.d } : null,
    valid,
    reason,
  }));

  if (!valid) return { symbol, triggered: false, reason };

  // Entry condition met — compute SL/TP and invoke step-orchestrator
  const entrada = currentPrice;
  const sl = cfg.direction === 'SELL'
    ? parseFloat((entrada + cfg.sl_points).toFixed(4))
    : parseFloat((entrada - cfg.sl_points).toFixed(4));
  const tp = cfg.direction === 'SELL'
    ? parseFloat((entrada - cfg.tp_points).toFixed(4))
    : parseFloat((entrada + cfg.tp_points).toFixed(4));

  // Build features for ML scorer
  const stochFeatures = stochCalc.extractStochFeatures(candles1H, candles5M, candles1M);

  const payload = {
    symbol,
    direction: cfg.direction,
    type: cfg.type,
    entrada,
    sl,
    tp,
    sl_points: cfg.sl_points,
    tp_points: cfg.tp_points,
    stoch1H,
    stoch5M,
    stoch1M,
    features: stochFeatures,
    config: cfg,
    timestamp: new Date().toISOString(),
  };

  // Invoke step-orchestrator Lambda (async — fire and forget per symbol)
  const functionName = process.env.AWS_LAMBDA_FUNCTION_NAME?.replace('signal-worker', 'step-orchestrator')
    || 'syntra-backend-dev-step-orchestrator';

  try {
    await lambdaClient.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',  // async invocation
      Payload: Buffer.from(JSON.stringify(payload)),
    }));
    console.log(JSON.stringify({ action: 'orchestratorInvoked', symbol, entrada, direction: cfg.direction }));
    return { symbol, triggered: true, reason: 'OK' };
  } catch (e) {
    console.log(JSON.stringify({ action: 'orchestratorInvokeError', symbol, error: e.message }));
    return { symbol, triggered: false, reason: `Invoke error: ${e.message}` };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'signal-worker-start', timestamp: new Date().toISOString() }));

  const symbols = Object.keys(INDEX_CFG);
  const results = [];

  // Process all symbols concurrently (with a small concurrency limit to avoid WS overload)
  // Process in batches of 3 to respect Deriv WS connection limits
  const BATCH_SIZE = 3;
  for (let i = 0; i < symbols.length; i += BATCH_SIZE) {
    const batch = symbols.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(s => processSymbol(s)));
    results.push(...batchResults);
  }

  const triggered = results.filter(r => r.triggered).map(r => r.symbol);
  console.log(JSON.stringify({
    action: 'signal-worker-done',
    total: symbols.length,
    triggered: triggered.length,
    symbols: triggered,
  }));

  return { triggered, results };
};
