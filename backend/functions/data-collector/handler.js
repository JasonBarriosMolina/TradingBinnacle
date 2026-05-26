'use strict';

/**
 * SYNTRA 2.0 — data-collector (v3)
 * Conecta al Deriv WebSocket API y extrae velas OHLC históricas
 * para los 10 índices en 3 temporalidades: 1H, 15M, 5M.
 *
 * Modos de operación:
 *   Daily incremental (default): pages = { '1H': 1, '15M': 1, '5M': 1 }
 *     → solo las últimas velas nuevas
 *   Historical backfill:         pages = { '1H': 1, '15M': 4, '5M': 10 }
 *     → ~7 meses 1H, ~6 meses 15M, ~6 meses 5M
 *
 * S3 output (ETL deduplica por epoch al leer):
 *   raw/{SYMBOL}/1H/candles_{ts}.json
 *   raw/{SYMBOL}/15M/candles_{ts}.json
 *   raw/{SYMBOL}/5M/candles_{ts}.json
 *
 * Event shapes:
 *   {}                                → incremental, todos los símbolos
 *   { historical: true }              → backfill 6 meses, todos los símbolos
 *   { symbol: 'CRASH500' }            → incremental, un símbolo
 *   { symbol: 'CRASH500', historical: true } → backfill, un símbolo
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const WebSocket = require('ws');

const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(',')
  : ['CRASH300N','CRASH500','CRASH600','CRASH900','CRASH1000',
     'BOOM300N','BOOM500','BOOM600','BOOM900','BOOM1000'];

const S3_BUCKET    = process.env.S3_BUCKET_DATA || 'syntra-data-dev';
const DERIV_APP_ID = process.env.DERIV_APP_ID   || '1089';
const WS_URL       = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

// Configuración por temporalidad
const GRANULARITIES = [
  { gran: 3600, label: '1H',  count: 5000 },  // 5000 × 1H  = ~208 días
  { gran: 900,  label: '15M', count: 5000 },  // 5000 × 15M = ~52 días por página
  { gran: 300,  label: '5M',  count: 5000 },  // 5000 × 5M  = ~17 días por página
];

// Páginas por temporalidad para backfill histórico (~6 meses)
const HISTORICAL_PAGES = {
  '1H':  1,   // 1 × 208 días = ya cubre 7 meses
  '15M': 4,   // 4 × 52 días  = ~6 meses
  '5M':  10,  // 10 × 17 días = ~6 meses
};

// ── WebSocket helper ──────────────────────────────────────────────────────────

function fetchCandles(symbol, granularity, count, endTime = 'latest') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    let done = false;

    const timer = setTimeout(() => {
      if (!done) { done = true; ws.terminate(); reject(new Error(`WS timeout ${symbol}/${granularity}`)); }
    }, 30000);

    ws.on('open', () => {
      const req = {
        ticks_history:     symbol,
        count,
        granularity,
        style:             'candles',
        adjust_start_time: 1,
      };
      if (endTime === 'latest') {
        req.end = 'latest';
      } else {
        req.end = endTime; // unix timestamp
      }
      ws.send(JSON.stringify(req));
    });

    ws.on('message', (raw) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      ws.close();
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.error) return reject(new Error(`Deriv [${symbol}/${granularity}]: ${msg.error.message}`));
        const candles = (msg.candles || []).map(c => ({
          epoch: c.epoch,
          open:  parseFloat(c.open),
          high:  parseFloat(c.high),
          low:   parseFloat(c.low),
          close: parseFloat(c.close),
        }));
        resolve(candles);
      } catch (e) {
        reject(new Error(`Parse error: ${e.message}`));
      }
    });

    ws.on('error', (err) => {
      if (!done) { done = true; clearTimeout(timer); reject(err); }
    });
  });
}

/**
 * Fetch N páginas de velas históricas paginando hacia atrás.
 * Cada página termina justo antes del inicio de la página anterior.
 */
async function fetchCandlesHistorical(symbol, granularity, count, pages) {
  let allCandles = [];
  let endTime    = 'latest';

  for (let page = 0; page < pages; page++) {
    try {
      const batch = await fetchCandles(symbol, granularity, count, endTime);
      if (!batch.length) break;

      // Prepend older candles al inicio
      allCandles = [...batch, ...allCandles];

      // Siguiente página termina justo antes del candle más antiguo de este batch
      endTime = batch[0].epoch - 1;

      console.log(JSON.stringify({
        action: 'page_fetched', symbol, granularity, page: page + 1,
        pages, batch_size: batch.length, oldest_epoch: batch[0].epoch,
      }));

      // Pequeña pausa entre páginas para no saturar la API
      if (page < pages - 1) await new Promise(r => setTimeout(r, 400));
    } catch (err) {
      console.error(JSON.stringify({ action: 'page_error', symbol, granularity, page, error: err.message }));
      break;
    }
  }

  // Deduplicar por epoch (por si hay solapamiento entre páginas)
  const seen = new Map();
  for (const c of allCandles) seen.set(c.epoch, c);
  const deduped = [...seen.values()].sort((a, b) => a.epoch - b.epoch);

  console.log(JSON.stringify({
    action: 'historical_complete', symbol, granularity,
    total_candles: deduped.length, pages_fetched: pages,
  }));

  return deduped;
}

// ── S3 save ───────────────────────────────────────────────────────────────────

async function saveToS3(symbol, granLabel, candles) {
  const now = new Date();
  const key = `raw/${symbol}/${granLabel}/candles_${now.getTime()}.json`;

  await s3.send(new PutObjectCommand({
    Bucket:      S3_BUCKET,
    Key:         key,
    Body:        JSON.stringify({ symbol, gran: granLabel, collected_at: now.toISOString(), count: candles.length, candles }),
    ContentType: 'application/json',
    Metadata:    { symbol, gran: granLabel, count: String(candles.length) },
  }));

  console.log(JSON.stringify({ action: 's3_saved', symbol, gran: granLabel, key, count: candles.length }));
  return key;
}

// ── Symbol processor ──────────────────────────────────────────────────────────

async function processSymbol(symbol, isHistorical) {
  try {
    const saved = [];

    // Fetch todas las granularidades — paralelas entre sí, páginas secuenciales dentro de cada una
    const results = await Promise.allSettled(
      GRANULARITIES.map(async ({ gran, label, count }) => {
        const pages = isHistorical ? HISTORICAL_PAGES[label] : 1;
        const candles = await fetchCandlesHistorical(symbol, gran, count, pages);
        return { label, candles };
      })
    );

    for (const result of results) {
      if (result.status === 'rejected') {
        console.error(JSON.stringify({ action: 'fetch_error', symbol, error: result.reason.message }));
        continue;
      }
      const { label, candles } = result.value;
      if (!candles.length) continue;
      const key = await saveToS3(symbol, label, candles);
      saved.push({ gran: label, count: candles.length, key });
    }

    return { symbol, success: saved.length > 0, saved };
  } catch (err) {
    console.error(JSON.stringify({ action: 'process_error', symbol, error: err.message }));
    return { symbol, success: false, error: err.message };
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const isHistorical = event.historical === true;
  console.log(JSON.stringify({ action: 'start', isHistorical, event }));

  const results = [];

  if (event.symbol) {
    results.push(await processSymbol(event.symbol, isHistorical));
  } else {
    const symbols = event.symbols || SYMBOLS;
    // Procesar en lotes de 3 para no saturar la API de Deriv
    for (let i = 0; i < symbols.length; i += 3) {
      const batch = symbols.slice(i, i + 3);
      const batchResults = await Promise.all(batch.map(s => processSymbol(s, isHistorical)));
      results.push(...batchResults);
      if (i + 3 < symbols.length) await new Promise(r => setTimeout(r, 1000));
    }
  }

  const success = results.filter(r => r.success).length;
  const failed  = results.filter(r => !r.success).length;

  console.log(JSON.stringify({ action: 'complete', isHistorical, success, failed }));
  return { statusCode: 200, body: JSON.stringify({ success, failed, results }) };
};
