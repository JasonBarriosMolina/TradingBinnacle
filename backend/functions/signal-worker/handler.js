'use strict';

/**
 * SYNTRA 2.0 — signal-worker (Fase 1)
 * EventBridge cada 5 min (06:00–24:00 CR).
 * Obtiene velas Deriv → Stoch(5,3,3) → condición → step-orchestrator.
 */

const WebSocket = require('ws');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const stoch = require('/opt/nodejs/index');

const DERIV_APP_ID    = process.env.DERIV_APP_ID || '1089';
const CANDLE_COUNT    = 30;
const lambdaClient    = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });

// Todos los símbolos con nombres exactos de Deriv (con sufijo N)
// Nombres exactos de Deriv: solo 300 lleva sufijo N; el resto sin N
const INDEX_CFG = {
  CRASH300N:  { type: 'crash', direction: 'SELL', require_1m: false, sl_points: 14, tp_points: 28 },
  CRASH500:   { type: 'crash', direction: 'SELL', require_1m: false, sl_points: 14, tp_points: 28 },
  CRASH600:   { type: 'crash', direction: 'SELL', require_1m: true,  sl_points: 14, tp_points: 28 },
  CRASH900:   { type: 'crash', direction: 'SELL', require_1m: true,  sl_points: 14, tp_points: 28 },
  CRASH1000:  { type: 'crash', direction: 'SELL', require_1m: false, sl_points: 14, tp_points: 28 },
  BOOM300N:   { type: 'boom',  direction: 'BUY',  require_1m: false, sl_points: 14, tp_points: 28 },
  BOOM500:    { type: 'boom',  direction: 'BUY',  require_1m: false, sl_points: 14, tp_points: 28 },
  BOOM600:    { type: 'boom',  direction: 'BUY',  require_1m: true,  sl_points: 14, tp_points: 28 },
  BOOM900:    { type: 'boom',  direction: 'BUY',  require_1m: true,  sl_points: 14, tp_points: 28 },
  BOOM1000:   { type: 'boom',  direction: 'BUY',  require_1m: false, sl_points: 14, tp_points: 28 },
};

function fetchCandles(symbol, granularity) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.terminate(); reject(new Error(`Timeout ${symbol}/${granularity}`)); }
    }, 18000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol, adjust_start_time: 1,
        count: CANDLE_COUNT, end: 'latest',
        granularity, style: 'candles',
      }));
    });

    ws.on('message', (raw) => {
      if (done) return;
      const msg = JSON.parse(raw.toString());
      if (msg.error) {
        done = true; clearTimeout(timer); ws.close();
        reject(new Error(`Deriv [${symbol}/${granularity}]: ${msg.error.message}`));
        return;
      }
      if (msg.candles) {
        done = true; clearTimeout(timer); ws.close();
        resolve(msg.candles.map(c => ({
          epoch: c.epoch,
          open:  +c.open, high: +c.high, low: +c.low, close: +c.close,
        })));
      }
    });

    ws.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

async function processSymbol(symbol) {
  const cfg = INDEX_CFG[symbol];
  try {
    const [c1H, c5M] = await Promise.all([
      fetchCandles(symbol, 3600),
      fetchCandles(symbol, 300),
    ]);
    const c1M = cfg.require_1m ? await fetchCandles(symbol, 60) : null;

    const s1H = stoch.getLastStoch(c1H);
    const s5M = stoch.getLastStoch(c5M);
    const s1M = c1M ? stoch.getLastStoch(c1M) : null;

    if (!s1H || !s5M) return { symbol, triggered: false, reason: 'Stoch null' };

    const { valid, reason } = stoch.checkEntryCondition(s1H, s5M, s1M, cfg.type, cfg.require_1m);
    console.log(JSON.stringify({ action: 'check', symbol, valid, reason, s1H, s5M, s1M }));
    if (!valid) return { symbol, triggered: false, reason };

    const entrada = c1H[c1H.length - 1].close;
    const sl = cfg.direction === 'SELL' ? +(entrada + cfg.sl_points).toFixed(4) : +(entrada - cfg.sl_points).toFixed(4);
    const tp = cfg.direction === 'SELL' ? +(entrada - cfg.tp_points).toFixed(4) : +(entrada + cfg.tp_points).toFixed(4);
    const features = stoch.extractStochFeatures(c1H, c5M, c1M);
    const zoneAnalysis = stoch.analyzeReactionZone(c1H, cfg.type, entrada);

    // Nombre de la función step-orchestrator (mismo prefijo, sufijo cambia)
    const myName = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
    const orchestratorName = myName.replace('signal-worker', 'step-orchestrator');

    await lambdaClient.send(new InvokeCommand({
      FunctionName: orchestratorName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        symbol, tipo: cfg.type.toUpperCase(), direccion: cfg.direction,
        entrada, sl, tp,
        sl_puntos: cfg.sl_points, tp_puntos: cfg.tp_points,
        stoch_1h_k: s1H.k, stoch_1h_d: s1H.d,
        stoch_5m_k: s5M.k, stoch_5m_d: s5M.d,
        stoch_1m_k: s1M?.k ?? null, stoch_1m_d: s1M?.d ?? null,
        features, zone: zoneAnalysis, timestamp: new Date().toISOString(),
      })),
    }));
    return { symbol, triggered: true, reason: 'OK' };

  } catch (err) {
    console.error(JSON.stringify({ action: 'error', symbol, error: err.message }));
    return { symbol, triggered: false, reason: err.message };
  }
}

exports.handler = async () => {
  console.log(JSON.stringify({ action: 'start', ts: new Date().toISOString() }));
  const symbols = Object.keys(INDEX_CFG);
  const results = [];

  // Procesar en lotes de 3 para no saturar conexiones WS
  for (let i = 0; i < symbols.length; i += 3) {
    const batch = symbols.slice(i, i + 3);
    const res = await Promise.all(batch.map(processSymbol));
    results.push(...res);
    if (i + 3 < symbols.length) await new Promise(r => setTimeout(r, 800));
  }

  const triggered = results.filter(r => r.triggered).map(r => r.symbol);
  console.log(JSON.stringify({ action: 'done', triggered }));
  return { triggered };
};
