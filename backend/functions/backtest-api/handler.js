'use strict';

/**
 * SYNTRA 2.0 — backtest-api
 * GET /backtest
 *   ?symbol=CRASH500
 *   &candleCount=200
 *   &slPoints=14
 *   &tpPoints=28
 *   &require1m=false
 *
 * Backtests the stoch(5,3,3) strategy on historical Deriv 1H candles.
 * Uses the stoch-calculator Lambda layer at /opt/nodejs/index.
 */

const WebSocket = require('ws');
const { calcStoch, checkEntryCondition, getLastStoch, MIN_CANDLES } = require('/opt/nodejs/index');

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const WS_TIMEOUT_MS = 20000;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
};

const ok  = (body)       => ({ statusCode: 200, headers: CORS, body: JSON.stringify(body) });
const bad = (msg)        => ({ statusCode: 400, headers: CORS, body: JSON.stringify({ error: msg }) });
const ise = (msg)        => ({ statusCode: 500, headers: CORS, body: JSON.stringify({ error: msg }) });

// ---------------------------------------------------------------------------
// Deriv WebSocket helper
// ---------------------------------------------------------------------------
function fetchCandles(symbol, granularity, count) {
  return new Promise((resolve, reject) => {
    const url = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;
    const ws = new WebSocket(url);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        ws.terminate();
        reject(new Error(`Timeout fetching ${symbol}/${granularity}`));
      }
    }, WS_TIMEOUT_MS);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history:    symbol,
        count:            count,
        end:              'latest',
        granularity:      granularity,
        style:            'candles',
        adjust_start_time: 1,
      }));
    });

    ws.on('message', (raw) => {
      if (done) return;
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch (e) { return; }

      if (msg.error) {
        done = true;
        clearTimeout(timer);
        ws.close();
        reject(new Error(`Deriv error [${symbol}/${granularity}]: ${msg.error.message}`));
        return;
      }

      if (msg.candles) {
        done = true;
        clearTimeout(timer);
        ws.close();
        resolve(msg.candles.map(c => ({
          epoch: c.epoch,
          open:  +c.open,
          high:  +c.high,
          low:   +c.low,
          close: +c.close,
        })));
      }
    });

    ws.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

// ---------------------------------------------------------------------------
// Determine instrument type from symbol name
// ---------------------------------------------------------------------------
function getSymbolType(symbol) {
  const upper = symbol.toUpperCase();
  if (upper.startsWith('CRASH')) return 'crash';
  if (upper.startsWith('BOOM'))  return 'boom';
  return null;
}

// ---------------------------------------------------------------------------
// Get the stoch values at window position i (using slice 0..i inclusive)
// ---------------------------------------------------------------------------
function stochAtIndex(candles, i) {
  const slice = candles.slice(0, i + 1);
  return getLastStoch(slice);
}

// ---------------------------------------------------------------------------
// Get the last N candles from a timeframe whose epoch <= refEpoch
// Used to find the relevant 5M (or 1M) candles at a given 1H bar
// ---------------------------------------------------------------------------
function getLowerTFWindow(lowerCandles, refEpoch, windowSize) {
  // Collect all candles with epoch <= refEpoch, then take last windowSize
  const eligible = lowerCandles.filter(c => c.epoch <= refEpoch);
  if (eligible.length === 0) return [];
  return eligible.slice(-Math.min(windowSize, eligible.length));
}

// ---------------------------------------------------------------------------
// Simulate one trade starting at 1H bar index i
// Returns { result: 'WIN'|'LOSS'|'NEUTRAL', bars, pnl }
// ---------------------------------------------------------------------------
function simulateTrade(c1H, startIdx, type, slPoints, tpPoints) {
  const entry = c1H[startIdx].close;

  let sl, tp;
  if (type === 'crash') {
    // SELL
    sl = entry + slPoints;
    tp = entry - tpPoints;
  } else {
    // BUY
    sl = entry - slPoints;
    tp = entry + tpPoints;
  }

  const MAX_BARS = 10;

  for (let b = 1; b <= MAX_BARS; b++) {
    const idx = startIdx + b;
    if (idx >= c1H.length) break;

    const bar = c1H[idx];

    if (type === 'crash') {
      // SELL: SL touched if HIGH >= sl; TP touched if LOW <= tp
      // Check SL first (conservative: assume worst case within bar)
      if (bar.high >= sl && bar.low <= tp) {
        // Both hit in same bar — assume SL hit first (worst case)
        return { result: 'LOSS', bars: b, pnl: -slPoints, entry, sl, tp };
      }
      if (bar.high >= sl) {
        return { result: 'LOSS', bars: b, pnl: -slPoints, entry, sl, tp };
      }
      if (bar.low <= tp) {
        return { result: 'WIN', bars: b, pnl: tpPoints, entry, sl, tp };
      }
    } else {
      // BUY: SL touched if LOW <= sl; TP touched if HIGH >= tp
      if (bar.low <= sl && bar.high >= tp) {
        // Both hit in same bar — assume SL hit first (worst case)
        return { result: 'LOSS', bars: b, pnl: -slPoints, entry, sl, tp };
      }
      if (bar.low <= sl) {
        return { result: 'LOSS', bars: b, pnl: -slPoints, entry, sl, tp };
      }
      if (bar.high >= tp) {
        return { result: 'WIN', bars: b, pnl: tpPoints, entry, sl, tp };
      }
    }
  }

  // Neither hit within MAX_BARS → NEUTRAL (close at market, skip from stats)
  const closeBar = c1H[Math.min(startIdx + MAX_BARS, c1H.length - 1)];
  const pnl = type === 'crash'
    ? +(entry - closeBar.open).toFixed(4)
    : +(closeBar.open - entry).toFixed(4);

  return { result: 'NEUTRAL', bars: MAX_BARS, pnl, entry, sl, tp };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: CORS, body: '' };
  }

  const qs = event.queryStringParameters || {};

  // --- Parse & validate params ---
  const symbol = (qs.symbol || '').trim().toUpperCase();
  if (!symbol) return bad('Missing required query param: symbol');

  const type = getSymbolType(symbol);
  if (!type) return bad(`Cannot determine type (crash/boom) from symbol: ${symbol}`);

  const candleCount = Math.max(MIN_CANDLES + 5, Math.min(500, parseInt(qs.candleCount, 10) || 200));
  const slPoints    = parseFloat(qs.slPoints)  || 14;
  const tpPoints    = parseFloat(qs.tpPoints)  || 28;
  const require1m   = qs.require1m === 'true';

  console.log(JSON.stringify({
    action: 'backtest-start', symbol, type, candleCount, slPoints, tpPoints, require1m,
  }));

  // --- Fetch candles ---
  let c1H, c5M, c1M;
  try {
    [c1H, c5M] = await Promise.all([
      fetchCandles(symbol, 3600, candleCount),
      fetchCandles(symbol, 300,  candleCount * 12),
    ]);
    c1M = require1m ? await fetchCandles(symbol, 60, candleCount * 60) : null;
  } catch (fetchErr) {
    console.error(JSON.stringify({ action: 'fetch-error', error: fetchErr.message }));
    return ise(`Failed to fetch candles from Deriv: ${fetchErr.message}`);
  }

  if (c1H.length < MIN_CANDLES) {
    return ise(`Not enough 1H candles returned (got ${c1H.length}, need ${MIN_CANDLES})`);
  }

  // --- Simulate ---
  const trades  = [];
  const equity  = [];
  let cumPnl    = 0;
  let inTrade   = false;
  let tradeEndIdx = -1; // 1H index where the active trade closed

  // 5M window size for stoch — we use the last 20 5M bars as approximation
  const LOWER_TF_WINDOW = 20;

  for (let i = MIN_CANDLES; i < c1H.length - 1; i++) {
    // Anti-overlap: skip if a trade is still open
    if (inTrade && i <= tradeEndIdx) continue;
    inTrade = false;

    // Build stoch values for this bar using all candles up to i
    const s1H = stochAtIndex(c1H, i);
    if (!s1H) continue;

    // 5M stoch: last LOWER_TF_WINDOW 5M bars at or before this 1H bar's epoch
    const window5M = getLowerTFWindow(c5M, c1H[i].epoch, LOWER_TF_WINDOW);
    if (window5M.length < MIN_CANDLES) continue;
    const s5M = getLastStoch(window5M);
    if (!s5M) continue;

    // Optional 1M stoch
    let s1M = null;
    if (require1m && c1M) {
      const window1M = getLowerTFWindow(c1M, c1H[i].epoch, LOWER_TF_WINDOW);
      if (window1M.length >= MIN_CANDLES) {
        s1M = getLastStoch(window1M);
      }
    }

    // Check entry condition
    const { valid } = checkEntryCondition(s1H, s5M, s1M, type, require1m);
    if (!valid) continue;

    // Simulate the trade
    const sim = simulateTrade(c1H, i, type, slPoints, tpPoints);

    if (sim.result === 'NEUTRAL') {
      // Count as neutral — still mark overlap window to avoid re-entry
      inTrade    = true;
      tradeEndIdx = i + sim.bars;
      continue;
    }

    inTrade     = true;
    tradeEndIdx = i + sim.bars;
    cumPnl     += sim.pnl;

    const tradeRecord = {
      index:  i,
      epoch:  c1H[i].epoch,
      entry:  +sim.entry.toFixed(4),
      sl:     +sim.sl.toFixed(4),
      tp:     +sim.tp.toFixed(4),
      result: sim.result,
      bars:   sim.bars,
      pnl:    sim.pnl,
    };

    trades.push(tradeRecord);
    equity.push({
      index:      i,
      epoch:      c1H[i].epoch,
      pnl:        sim.pnl,
      cumulative: +cumPnl.toFixed(4),
    });
  }

  // --- Build stats (exclude NEUTRAL trades which were filtered above) ---
  const wins   = trades.filter(t => t.result === 'WIN');
  const losses = trades.filter(t => t.result === 'LOSS');
  const total  = trades.length;

  const pnlTotal = +trades.reduce((s, t) => s + t.pnl, 0).toFixed(4);
  const pnlAvg   = total > 0 ? +(pnlTotal / total).toFixed(2) : 0;
  const winRate  = total > 0 ? +((wins.length / total) * 100).toFixed(1) : 0;
  const avgBars  = total > 0
    ? +(trades.reduce((s, t) => s + t.bars, 0) / total).toFixed(1)
    : 0;

  const stats = {
    total,
    wins:    wins.length,
    losses:  losses.length,
    winRate,
    pnlTotal,
    pnlAvg,
    avgBars,
  };

  console.log(JSON.stringify({ action: 'backtest-done', symbol, stats }));

  return ok({
    symbol,
    candleCount: c1H.length,
    slPoints,
    tpPoints,
    require1m,
    trades,
    stats,
    equity,
  });
};
