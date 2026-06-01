'use strict';

/**
 * SYNTRA 2.0 — signal-worker (v2)
 * EventBridge cada 5 min (06:00–24:00 CR).
 *
 * Pipeline de filtros (en orden — falla rápido):
 *   1. Cooldown (< 30 min desde última señal del mismo símbolo)
 *   2. Tendencia: LH+LL (crash) o HH+HL (boom) en 1H via swing points
 *   3. DOS ESTRATEGIAS EN PARALELO — señal si CUALQUIERA pasa:
 *      A. Zona extrema: 1H K>80 + 15M K>80 + 5M K>80 + hook K/D en 1H o 15M
 *      B. Trend+crossover: K cruzó D en 1H o 15M (cualquier nivel) + crossover 5M confirma
 */

const WebSocket = require('ws');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { DynamoDBClient, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const stoch = require('/opt/nodejs/index');

const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089';
const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
const dynamo       = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });

const ML_TABLE           = process.env.DYNAMODB_TABLE_ML_STATUS || 'syntra-ml-status';
const SIGNAL_COOLDOWN_MS = 20 * 60 * 1000; // 20 minutos

// Más velas 1H para tener suficientes swing points para tendencia
const CANDLE_COUNT_1H  = 50;
const CANDLE_COUNT_15M = 30;
const CANDLE_COUNT_5M  = 30;

const INDEX_CFG = {
  CRASH300N:  { type: 'crash', direction: 'SELL', sl_points: 14, tp_points: 28 },
  CRASH500:   { type: 'crash', direction: 'SELL', sl_points: 14, tp_points: 28 },
  CRASH600:   { type: 'crash', direction: 'SELL', sl_points: 14, tp_points: 28 },
  CRASH900:   { type: 'crash', direction: 'SELL', sl_points: 14, tp_points: 28 },
  CRASH1000:  { type: 'crash', direction: 'SELL', sl_points: 14, tp_points: 28 },
  BOOM300N:   { type: 'boom',  direction: 'BUY',  sl_points: 14, tp_points: 28 },
  BOOM500:    { type: 'boom',  direction: 'BUY',  sl_points: 14, tp_points: 28 },
  BOOM600:    { type: 'boom',  direction: 'BUY',  sl_points: 14, tp_points: 28 },
  BOOM900:    { type: 'boom',  direction: 'BUY',  sl_points: 14, tp_points: 28 },
  BOOM1000:   { type: 'boom',  direction: 'BUY',  sl_points: 14, tp_points: 28 },
};

// ── WebSocket helper ──────────────────────────────────────────────────────────

function fetchCandles(symbol, granularity, count) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.terminate(); reject(new Error(`Timeout ${symbol}/${granularity}`)); }
    }, 18000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        ticks_history: symbol, adjust_start_time: 1,
        count, end: 'latest', granularity, style: 'candles',
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
          open: +c.open, high: +c.high, low: +c.low, close: +c.close,
        })));
      }
    });

    ws.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

// ── Cooldown (deduplicación de señales) ───────────────────────────────────────

async function isInCooldown(symbol) {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: ML_TABLE,
      Key: { symbol: { S: `signal_cooldown_${symbol}` } },
    }));
    if (!result.Item) return false;
    const lastTs = parseInt(result.Item.last_signal_ts?.N || '0', 10);
    return Date.now() - lastTs < SIGNAL_COOLDOWN_MS;
  } catch {
    return false; // fail open — no bloquear si DDB falla
  }
}

async function setSignalCooldown(symbol) {
  try {
    await dynamo.send(new PutItemCommand({
      TableName: ML_TABLE,
      Item: {
        symbol:         { S: `signal_cooldown_${symbol}` },
        last_signal_ts: { N: String(Date.now()) },
        updated_at:     { S: new Date().toISOString() },
        status:         { S: 'signal_sent' },
      },
    }));
  } catch (e) {
    console.error(JSON.stringify({ action: 'cooldown_save_error', symbol, error: e.message }));
  }
}

// ── Main symbol processor ─────────────────────────────────────────────────────

async function processSymbol(symbol) {
  const cfg     = INDEX_CFG[symbol];
  const isCrash = cfg.type === 'crash';

  try {
    // ── 1. Cooldown ──────────────────────────────────────────────────────────
    if (await isInCooldown(symbol)) {
      return { symbol, triggered: false, reason: 'Cooldown activo (< 30 min)' };
    }

    // ── 2. Fetch candles (en paralelo) ───────────────────────────────────────
    const [c1H, c15M, c5M] = await Promise.all([
      fetchCandles(symbol, 3600, CANDLE_COUNT_1H),
      fetchCandles(symbol, 900,  CANDLE_COUNT_15M),
      fetchCandles(symbol, 300,  CANDLE_COUNT_5M),
    ]);

    // ── 3. Tendencia: LH+LL (crash) o HH+HL (boom) en 1H ────────────────────
    const swingHighs = stoch.findSwingPoints(c1H, 'high', 2);
    const swingLows  = stoch.findSwingPoints(c1H, 'low',  2);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return { symbol, triggered: false, reason: 'Insuficientes swing points en 1H para tendencia' };
    }

    const lastHigh = swingHighs[swingHighs.length - 1];
    const prevHigh = swingHighs[swingHighs.length - 2];
    const lastLow  = swingLows[swingLows.length - 1];
    const prevLow  = swingLows[swingLows.length - 2];

    const trendOk = isCrash
      ? (lastHigh.price < prevHigh.price && lastLow.price < prevLow.price)   // LH + LL
      : (lastHigh.price > prevHigh.price && lastLow.price > prevLow.price);  // HH + HL

    if (!trendOk) {
      const reason = isCrash
        ? `No LH+LL: H=${lastHigh.price.toFixed(4)}<${prevHigh.price.toFixed(4)}? L=${lastLow.price.toFixed(4)}<${prevLow.price.toFixed(4)}?`
        : `No HH+HL: H=${lastHigh.price.toFixed(4)}>${prevHigh.price.toFixed(4)}? L=${lastLow.price.toFixed(4)}>${prevLow.price.toFixed(4)}?`;
      console.log(JSON.stringify({ action: 'check', symbol, triggered: false, reason }));
      return { symbol, triggered: false, reason };
    }

    // ── 4. Stoch en todas las TF ──────────────────────────────────────────────
    const { K: K1H,  D: D1H  } = stoch.calcStoch(c1H);
    const { K: K15M, D: D15M } = stoch.calcStoch(c15M);
    const { K: K5M,  D: D5M  } = stoch.calcStoch(c5M);

    const s1H  = stoch.getLastStoch(c1H);
    const s15M = stoch.getLastStoch(c15M);
    const s5M  = stoch.getLastStoch(c5M);

    if (!s1H || !s15M || !s5M) {
      return { symbol, triggered: false, reason: 'Stoch null (candles insuficientes)' };
    }

    // ── 4-5. Dos estrategias en paralelo — señal si CUALQUIERA pasa ───────────

    // Estrategia A: Zona extrema estricta (1H + 15M + 5M en zona >80/<20 + hook K/D dentro de zona)
    const zone1H  = isCrash ? (s1H.k > 80  && s1H.d > 80)  : (s1H.k < 20  && s1H.d < 20);
    const zone15M = isCrash ? (s15M.k > 80 && s15M.d > 80) : (s15M.k < 20 && s15M.d < 20);
    const zone5M  = isCrash ? (s5M.k > 80)                  : (s5M.k < 20);
    const hook1H  = stoch.detectHook(K1H,  D1H,  cfg.type);
    const hook15M = stoch.detectHook(K15M, D15M, cfg.type);
    const estrategiaA = zone1H && zone15M && zone5M && (hook1H || hook15M);

    // Estrategia B: Tendencia confirmada por swing points en 1H (sin validar stoch 1H)
    //   + dirección estricta del stoch en 5M y 15M alineados con la tendencia
    //   CRASH: K < D en 5M y 15M → presión bajista activa en ambos TF
    //   BOOM:  K > D en 5M y 15M → presión alcista activa en ambos TF
    const cross1H      = stoch.detectCrossoverAny(K1H,  D1H,  cfg.type); // solo para log
    const trend5M_B    = isCrash ? s5M.k  < s5M.d  : s5M.k  > s5M.d;
    const trend15M_B   = isCrash ? s15M.k < s15M.d : s15M.k > s15M.d;
    const estrategiaB  = trend5M_B && trend15M_B;

    if (!estrategiaA && !estrategiaB) {
      return { symbol, triggered: false,
        reason: `Sin setup: 1H K=${s1H.k.toFixed(1)}/D=${s1H.d.toFixed(1)} 15M K=${s15M.k.toFixed(1)}/D=${s15M.d.toFixed(1)}` };
    }

    const strategyLabel = estrategiaA ? 'zona_extrema' : 'trend_crossover';

    // ── 6. Construir features ─────────────────────────────────────────────────
    const entrada  = c5M[c5M.length - 1].close;
    const now      = new Date();
    const zoneAnal = stoch.analyzeReactionZone(c1H, cfg.type, entrada);

    const lh_magnitude = parseFloat((Math.abs((lastHigh.price - prevHigh.price) / prevHigh.price) * 100).toFixed(4));
    const hl_magnitude = parseFloat((Math.abs((lastLow.price  - prevLow.price)  / prevLow.price)  * 100).toFixed(4));

    const swingRef          = isCrash ? lastHigh : lastLow;
    const swingIdx          = c1H.findIndex(c => c.epoch === swingRef.epoch);
    const candles_since_swing = swingIdx >= 0 ? c1H.length - 1 - swingIdx : 0;

    const momentum_5m = c5M.length >= 6
      ? parseFloat(((c5M[c5M.length - 1].close - c5M[c5M.length - 6].close) / c5M[c5M.length - 6].close * 100).toFixed(4))
      : 0;

    // tf_alignment: cuántos TF tienen K en relación correcta con D (K<D crash, K>D boom)
    const kBelowD1H  = isCrash ? s1H.k  < s1H.d  : s1H.k  > s1H.d;
    const kBelowD15M = isCrash ? s15M.k < s15M.d : s15M.k > s15M.d;
    const kBelowD5M  = isCrash ? s5M.k  < s5M.d  : s5M.k  > s5M.d;
    const tf_alignment = [kBelowD1H, kBelowD15M, kBelowD5M].filter(Boolean).length;

    const features = {
      stoch_1h_k:        s1H.k,
      stoch_1h_d:        s1H.d,
      stoch_1h_kd_diff:  parseFloat((s1H.k - s1H.d).toFixed(4)),
      stoch_1h_d_slope:  parseFloat(stoch.calcSlope(D1H).toFixed(4)),

      stoch_15m_k:       s15M.k,
      stoch_15m_d:       s15M.d,
      stoch_15m_kd_diff: parseFloat((s15M.k - s15M.d).toFixed(4)),
      stoch_15m_d_slope: parseFloat(stoch.calcSlope(D15M).toFixed(4)),

      stoch_5m_k:        s5M.k,
      stoch_5m_d:        s5M.d,
      stoch_5m_kd_diff:  parseFloat((s5M.k - s5M.d).toFixed(4)),
      stoch_5m_d_slope:  parseFloat(stoch.calcSlope(D5M).toFixed(4)),

      tf_alignment,
      trend_confirmed:   1,
      lh_magnitude,
      hl_magnitude,

      hour_of_day:       now.getUTCHours(),
      day_of_week:       now.getUTCDay(),

      zone_distance_pct: zoneAnal.distancePct ?? 0,
      price_in_zone:     zoneAnal.priceInZone ? 1 : 0,

      candles_since_swing,
      momentum_5m,

      stoch_1h_hook:  hook1H  || cross1H,
      stoch_15m_hook: hook15M,
    };

    // ── 7. Guardar cooldown ───────────────────────────────────────────────────
    await setSignalCooldown(symbol);

    // ── 8. Invocar step-orchestrator (fire-and-forget) ────────────────────────
    const sl = cfg.direction === 'SELL'
      ? +(entrada + cfg.sl_points).toFixed(4)
      : +(entrada - cfg.sl_points).toFixed(4);
    const tp = cfg.direction === 'SELL'
      ? +(entrada - cfg.tp_points).toFixed(4)
      : +(entrada + cfg.tp_points).toFixed(4);

    const myName           = process.env.AWS_LAMBDA_FUNCTION_NAME || '';
    const orchestratorName = myName.replace('signal-worker', 'step-orchestrator');

    await lambdaClient.send(new InvokeCommand({
      FunctionName:   orchestratorName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({
        symbol, tipo: cfg.type.toUpperCase(), direccion: cfg.direction,
        entrada, sl, tp,
        sl_puntos: cfg.sl_points, tp_puntos: cfg.tp_points,
        stoch_1h_k:  s1H.k,  stoch_1h_d:  s1H.d,
        stoch_15m_k: s15M.k, stoch_15m_d: s15M.d,
        stoch_5m_k:  s5M.k,  stoch_5m_d:  s5M.d,
        hook_1h: hook1H || cross1H, hook_15m: hook15M,
        trend_confirmed: 1, tf_alignment,
        strategy: strategyLabel,
        features, zone: zoneAnal, timestamp: new Date().toISOString(),
      })),
    }));

    console.log(JSON.stringify({
      action: 'signal_sent', symbol, strategy: strategyLabel,
      estrategiaA, estrategiaB, tf_alignment,
      s1H, s15M, s5M,
    }));
    return { symbol, triggered: true, reason: 'OK' };

  } catch (err) {
    console.error(JSON.stringify({ action: 'error', symbol, error: err.message }));
    return { symbol, triggered: false, reason: err.message };
  }
}

// ── Heartbeat (status cada 2 horas si no hay señales) ────────────────────────

const HEARTBEAT_KEY     = 'heartbeat_status';
const HEARTBEAT_GAP_MS  = 2 * 60 * 60 * 1000; // 2 horas
const BOT_TOKEN         = process.env.TELEGRAM_BOT_TOKEN  || '';
const ADMIN_CHAT_ID     = process.env.ADMIN_TELEGRAM_CHAT_ID || '';

async function shouldSendHeartbeat() {
  try {
    const result = await dynamo.send(new GetItemCommand({
      TableName: ML_TABLE,
      Key: { symbol: { S: HEARTBEAT_KEY } },
    }));
    if (!result.Item) return true;
    const lastTs = parseInt(result.Item.last_signal_ts?.N || '0', 10);
    return Date.now() - lastTs >= HEARTBEAT_GAP_MS;
  } catch { return false; }
}

async function markHeartbeatSent() {
  try {
    await dynamo.send(new PutItemCommand({
      TableName: ML_TABLE,
      Item: {
        symbol:         { S: HEARTBEAT_KEY },
        last_signal_ts: { N: String(Date.now()) },
        updated_at:     { S: new Date().toISOString() },
        status:         { S: 'heartbeat' },
      },
    }));
  } catch { /* non-critical */ }
}

function buildHeartbeatMessage(results) {
  const now = new Date().toLocaleString('es-CR', {
    timeZone: 'America/Costa_Rica',
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });

  // Clasifica cada símbolo por el filtro que lo bloqueó
  const noTrend    = results.filter(r => r.reason?.includes('LH+LL') || r.reason?.includes('HH+HL') || r.reason?.includes('swing'));
  const noSetup    = results.filter(r => r.reason?.includes('Sin setup'));
  const cooldown   = results.filter(r => r.reason?.includes('Cooldown'));

  let msg = `🔍 <b>SYNTRA — Sin señales</b>\n`;
  msg += `🕐 ${now}\n`;
  msg += `─────────────────────────\n`;

  if (noTrend.length) {
    msg += `\n📉 <b>Sin tendencia confirmada (${noTrend.length}):</b>\n`;
    msg += noTrend.map(r => `   ${r.symbol}`).join('\n') + '\n';
  }

  if (noSetup.length) {
    msg += `\n📊 <b>Tendencia ✅ · Sin setup A ni B (${noSetup.length}):</b>\n`;
    msg += noSetup.map(r => {
      const match = r.reason?.match(/1H K=([\d.]+)\/D=([\d.]+)/);
      const vals = match ? ` 1H K=${match[1]} D=${match[2]}` : '';
      return `   ${r.symbol}${vals}`;
    }).join('\n') + '\n';
  }

  if (cooldown.length) {
    msg += `\n⏳ <b>Cooldown activo (${cooldown.length}):</b>\n`;
    msg += cooldown.map(r => `   ${r.symbol}`).join('\n') + '\n';
  }

  msg += `\n─────────────────────────\n`;
  msg += `👁 Monitoreando 10 índices · cada 5 min`;

  return msg;
}

async function sendHeartbeat(msg) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ chat_id: ADMIN_CHAT_ID, text: msg, parse_mode: 'HTML' }),
    });
    console.log(JSON.stringify({ action: 'heartbeat_sent' }));
  } catch (e) {
    console.error(JSON.stringify({ action: 'heartbeat_error', error: e.message }));
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async () => {
  console.log(JSON.stringify({ action: 'start', ts: new Date().toISOString() }));
  const symbols = Object.keys(INDEX_CFG);
  const results = [];

  // Procesar en lotes de 3 para no saturar conexiones WS
  for (let i = 0; i < symbols.length; i += 3) {
    const batch = symbols.slice(i, i + 3);
    const res   = await Promise.all(batch.map(processSymbol));
    results.push(...res);
    if (i + 3 < symbols.length) await new Promise(r => setTimeout(r, 800));
  }

  const triggered = results.filter(r => r.triggered).map(r => r.symbol);
  console.log(JSON.stringify({ action: 'done', triggered, results }));

  // Heartbeat: si no hubo señales y pasaron 2h desde el último status → avisa
  if (triggered.length === 0 && await shouldSendHeartbeat()) {
    const msg = buildHeartbeatMessage(results);
    await sendHeartbeat(msg);
    await markHeartbeatSent();
  }

  return { triggered };
};
