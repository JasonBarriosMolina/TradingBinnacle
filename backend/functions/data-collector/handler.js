'use strict';

/**
 * SYNTRA 2.0 — data-collector
 * Conecta al Deriv WebSocket API y extrae histórico de ticks
 * para los 10 índices. Guarda en S3 particionado por símbolo/fecha.
 *
 * Invocación: manual o EventBridge (una vez por símbolo).
 * Event: { symbol: 'CRASH300N', count: 5000 } o { all: true }
 */

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const https = require('https');
const { ALL_SYMBOLS, INDEX_CONFIG } = require('/opt/nodejs/stoch-calculator/../../../src/config/indices');

// En Lambda Layer el stoch está en /opt/nodejs/stoch-calculator
// indices.js se accede vía env o bundled
const SYMBOLS = process.env.SYMBOLS
  ? process.env.SYMBOLS.split(',')
  : ['CRASH300N','CRASH500N','CRASH600N','CRASH900N','CRASH1000N',
     'BOOM300N','BOOM500N','BOOM600N','BOOM900N','BOOM1000N'];

const S3_BUCKET   = process.env.S3_BUCKET_DATA || 'syntra-data-dev';
const DERIV_APP_ID = process.env.DERIV_APP_ID || '1089'; // demo app id
const WS_URL      = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`;

const s3 = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Conecta a Deriv WebSocket y obtiene ticks históricos de un símbolo.
 * @param {string} symbol — e.g. 'CRASH300N'
 * @param {number} count  — número de ticks a obtener (max 5000 por request)
 * @returns {Promise<Array<{epoch: number, quote: number}>>}
 */
function fetchTickHistory(symbol, count = 5000) {
  return new Promise((resolve, reject) => {
    // En Lambda no hay WebSocket nativo, usamos https para la API REST de Deriv
    // Deriv tiene endpoint REST para tick history
    const endpoint = `https://api.deriv.com/tickHistory/${symbol}?count=${count}&end=latest&style=ticks`;

    console.log(JSON.stringify({ action: 'fetch_start', symbol, count }));

    // Usamos la API pública de Deriv (no requiere auth para ticks sintéticos)
    const req = https.get(
      `https://api.deriv.com/api/v2/tickHistory?symbol=${symbol}&count=${count}&end=latest&style=ticks&app_id=${DERIV_APP_ID}`,
      (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) {
              reject(new Error(`Deriv API error: ${parsed.error.message}`));
              return;
            }
            // Formato Deriv: { history: { times: [...], prices: [...] } }
            const times  = parsed.history?.times  || [];
            const prices = parsed.history?.prices || [];
            const ticks  = times.map((epoch, i) => ({ epoch, quote: parseFloat(prices[i]) }));
            console.log(JSON.stringify({ action: 'fetch_complete', symbol, ticks_received: ticks.length }));
            resolve(ticks);
          } catch (e) {
            reject(new Error(`Parse error: ${e.message} — raw: ${data.substring(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('Request timeout')); });
  });
}

/**
 * Sube los ticks de un símbolo a S3.
 * Ruta: s3://syntra-data/{stage}/raw/{symbol}/{YYYY-MM-DD}/ticks_{timestamp}.json
 * @param {string} symbol
 * @param {Array<{epoch:number, quote:number}>} ticks
 */
async function saveToS3(symbol, ticks) {
  const now  = new Date();
  const date = now.toISOString().slice(0, 10); // YYYY-MM-DD
  const ts   = now.getTime();
  const key  = `raw/${symbol}/${date}/ticks_${ts}.json`;

  const payload = {
    symbol,
    collected_at: now.toISOString(),
    count: ticks.length,
    ticks,
  };

  await s3.send(new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key:    key,
    Body:   JSON.stringify(payload),
    ContentType: 'application/json',
    Metadata: { symbol, date, count: String(ticks.length) },
  }));

  console.log(JSON.stringify({ action: 's3_saved', symbol, key, count: ticks.length }));
  return key;
}

/**
 * Procesa un símbolo: fetch + save.
 */
async function processSymbol(symbol, count) {
  try {
    const ticks = await fetchTickHistory(symbol, count);
    if (!ticks.length) {
      console.log(JSON.stringify({ action: 'no_ticks', symbol }));
      return { symbol, success: false, error: 'No ticks received' };
    }
    const key = await saveToS3(symbol, ticks);
    return { symbol, success: true, key, count: ticks.length };
  } catch (err) {
    console.error(JSON.stringify({ action: 'process_error', symbol, error: err.message }));
    return { symbol, success: false, error: err.message };
  }
}

/**
 * Handler principal.
 *
 * Event shapes:
 *   { symbol: 'CRASH300N', count: 5000 }   → procesa un símbolo
 *   { all: true, count: 1000 }              → procesa los 10 símbolos
 *   {}                                      → procesa los 10 símbolos con default count
 */
exports.handler = async (event) => {
  console.log(JSON.stringify({ action: 'start', event }));

  const count  = event.count || 5000;
  const results = [];

  if (event.symbol) {
    // Procesar un solo símbolo
    const result = await processSymbol(event.symbol, count);
    results.push(result);
  } else {
    // Procesar todos — secuencialmente para no saturar la API de Deriv
    const symbols = event.symbols || SYMBOLS;
    for (const symbol of symbols) {
      const result = await processSymbol(symbol, count);
      results.push(result);
      // Pequeña pausa entre requests para respetar rate limits
      await new Promise(r => setTimeout(r, 500));
    }
  }

  const success = results.filter(r => r.success).length;
  const failed  = results.filter(r => !r.success).length;

  console.log(JSON.stringify({ action: 'complete', success, failed, results }));

  return {
    statusCode: 200,
    body: JSON.stringify({ success, failed, results }),
  };
};
