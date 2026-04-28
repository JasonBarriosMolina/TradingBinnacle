'use strict';

/**
 * SYNTRA 2.0 — Stochastic Oscillator (5, 3, 3)
 * Implementado desde cero. Sin librerías externas.
 *
 * Parámetros:
 *   kPeriod  = 5   → ventana para el %K raw (highest high / lowest low)
 *   smooth   = 3   → SMA del %K raw → %K suavizado (lo que se muestra como K)
 *   dPeriod  = 3   → SMA del %K suavizado → %D
 *
 * Entrada esperada: array de candles { high, low, close }
 * ordenados de más antiguo a más reciente.
 *
 * Salida: { k, d } — valores del último candle (0-100)
 *         o null si no hay suficientes datos.
 */

const STOCH_K_PERIOD = 5;
const STOCH_SMOOTH   = 3;
const STOCH_D_PERIOD = 3;

// Mínimo de candles requeridos: kPeriod + smooth + dPeriod - 2 = 5+3+3-2 = 9
const MIN_CANDLES = STOCH_K_PERIOD + STOCH_SMOOTH + STOCH_D_PERIOD - 2;

/**
 * Calcula la SMA simple de un array de números.
 * @param {number[]} arr
 * @param {number} period
 * @returns {number[]} — array de misma longitud, nulls al inicio
 */
function sma(arr, period) {
  const result = new Array(arr.length).fill(null);
  for (let i = period - 1; i < arr.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += arr[i - j];
    result[i] = sum / period;
  }
  return result;
}

/**
 * Calcula el %K raw para cada candle.
 * %K_raw[i] = (close[i] - lowestLow[i-4..i]) / (highestHigh[i-4..i] - lowestLow[i-4..i]) * 100
 *
 * @param {Array<{high:number,low:number,close:number}>} candles
 * @returns {number[]} — array con nulls en los primeros kPeriod-1 índices
 */
function calcRawK(candles) {
  const rawK = new Array(candles.length).fill(null);
  for (let i = STOCH_K_PERIOD - 1; i < candles.length; i++) {
    let lo = Infinity, hi = -Infinity;
    for (let j = i - (STOCH_K_PERIOD - 1); j <= i; j++) {
      if (candles[j].low  < lo) lo = candles[j].low;
      if (candles[j].high > hi) hi = candles[j].high;
    }
    rawK[i] = hi === lo ? 50 : ((candles[i].close - lo) / (hi - lo)) * 100;
  }
  return rawK;
}

/**
 * Calcula el Stochastic (5,3,3) completo sobre un array de candles.
 * Retorna arrays K[] y D[] del mismo largo que candles[].
 * Las posiciones sin suficientes datos tienen valor null.
 *
 * @param {Array<{high:number,low:number,close:number}>} candles
 * @returns {{ K: Array<number|null>, D: Array<number|null> }}
 */
function calcStoch(candles) {
  if (!candles || candles.length < MIN_CANDLES) {
    return { K: [], D: [] };
  }

  const rawK = calcRawK(candles);

  // %K suavizado = SMA(3) del rawK
  const smoothedK = sma(rawK.filter(v => v !== null), STOCH_SMOOTH);

  // Reconstruir con los nulls originales
  const firstValid = STOCH_K_PERIOD - 1; // índice donde rawK empieza a tener valores
  const K = new Array(candles.length).fill(null);
  for (let i = 0; i < smoothedK.length; i++) {
    K[i + firstValid] = smoothedK[i];
  }

  // %D = SMA(3) del K suavizado
  const validK = smoothedK.filter(v => v !== null);
  const smoothedD = sma(validK, STOCH_D_PERIOD);

  const firstValidK = firstValid + STOCH_SMOOTH - 1;
  const D = new Array(candles.length).fill(null);
  for (let i = 0; i < smoothedD.length; i++) {
    D[i + firstValidK] = smoothedD[i];
  }

  return { K, D };
}

/**
 * Obtiene el último valor K y D válidos del array de candles.
 * Útil para señales en tiempo real.
 *
 * @param {Array<{high:number,low:number,close:number}>} candles
 * @returns {{ k: number, d: number } | null}
 */
function getLastStoch(candles) {
  const { K, D } = calcStoch(candles);
  if (!K.length || !D.length) return null;

  // Buscar último valor no-null desde el final
  let k = null, d = null;
  for (let i = K.length - 1; i >= 0; i--) {
    if (k === null && K[i] !== null) k = K[i];
    if (d === null && D[i] !== null) d = D[i];
    if (k !== null && d !== null) break;
  }

  if (k === null || d === null) return null;
  return {
    k: parseFloat(k.toFixed(4)),
    d: parseFloat(d.toFixed(4))
  };
}

/**
 * Evalúa si la condición de entrada Stoch se cumple para un índice dado.
 *
 * @param {{ k: number, d: number }} stoch1H
 * @param {{ k: number, d: number }} stoch5M
 * @param {{ k: number, d: number } | null} stoch1M
 * @param {'crash'|'boom'} type
 * @param {boolean} require1M
 * @returns {{ valid: boolean, reason: string }}
 */
function checkEntryCondition(stoch1H, stoch5M, stoch1M, type, require1M) {
  const isCrash = type === 'crash';
  const threshold = isCrash ? 80 : 20;
  const compare = isCrash
    ? (v) => v > threshold
    : (v) => v < threshold;

  const check1H = compare(stoch1H.k) && compare(stoch1H.d);
  const check5M = compare(stoch5M.k) && compare(stoch5M.d);

  if (!check1H) {
    return {
      valid: false,
      reason: `1H K(${stoch1H.k.toFixed(1)}) o D(${stoch1H.d.toFixed(1)}) no cumple condición ${isCrash ? '>' : '<'}${threshold}`
    };
  }
  if (!check5M) {
    return {
      valid: false,
      reason: `5M K(${stoch5M.k.toFixed(1)}) o D(${stoch5M.d.toFixed(1)}) no cumple condición ${isCrash ? '>' : '<'}${threshold}`
    };
  }
  if (require1M) {
    if (!stoch1M) {
      return { valid: false, reason: '1M requerido pero no disponible' };
    }
    if (!compare(stoch1M.k) || !compare(stoch1M.d)) {
      return {
        valid: false,
        reason: `1M K(${stoch1M.k.toFixed(1)}) o D(${stoch1M.d.toFixed(1)}) no cumple condición ${isCrash ? '>' : '<'}${threshold}`
      };
    }
  }

  return { valid: true, reason: 'OK' };
}

/**
 * Calcula la pendiente de los últimos N valores de un array.
 * Usada como feature para ML (stoch_Xm_d_slope).
 *
 * @param {Array<number|null>} arr
 * @param {number} n — últimos N valores
 * @returns {number}
 */
function calcSlope(arr, n = 3) {
  const valid = arr.filter(v => v !== null).slice(-n);
  if (valid.length < 2) return 0;
  return (valid[valid.length - 1] - valid[0]) / (valid.length - 1);
}

/**
 * Extrae todos los features Stoch requeridos por el modelo ML.
 *
 * @param {Array<{high,low,close}>} candles1H
 * @param {Array<{high,low,close}>} candles5M
 * @param {Array<{high,low,close}>|null} candles1M
 * @returns {Object} features
 */
function extractStochFeatures(candles1H, candles5M, candles1M) {
  const { K: K1H, D: D1H } = calcStoch(candles1H);
  const { K: K5M, D: D5M } = calcStoch(candles5M);

  const last1H = getLastStoch(candles1H);
  const last5M = getLastStoch(candles5M);

  const features = {
    stoch_1h_k:       last1H?.k ?? null,
    stoch_1h_d:       last1H?.d ?? null,
    stoch_1h_kd_diff: last1H ? last1H.k - last1H.d : null,
    stoch_1h_d_slope: calcSlope(D1H),

    stoch_5m_k:       last5M?.k ?? null,
    stoch_5m_d:       last5M?.d ?? null,
    stoch_5m_kd_diff: last5M ? last5M.k - last5M.d : null,
    stoch_5m_d_slope: calcSlope(D5M),

    stoch_1m_k:       null,
    stoch_1m_d:       null,
    stoch_1m_kd_diff: null,
    stoch_1m_d_slope: null,
  };

  if (candles1M && candles1M.length >= MIN_CANDLES) {
    const { K: K1M, D: D1M } = calcStoch(candles1M);
    const last1M = getLastStoch(candles1M);
    features.stoch_1m_k       = last1M?.k ?? null;
    features.stoch_1m_d       = last1M?.d ?? null;
    features.stoch_1m_kd_diff = last1M ? last1M.k - last1M.d : null;
    features.stoch_1m_d_slope = calcSlope(D1M);
  }

  return features;
}

/**
 * Detecta swing highs o swing lows en un array de candles 1H.
 * Un swing high: su high supera los 'lookback' candles antes y después.
 * Un swing low:  su low  es menor que los 'lookback' candles antes y después.
 *
 * @param {Array<{high,low,close,epoch}>} candles
 * @param {'high'|'low'} type
 * @param {number} lookback — candles a cada lado para confirmar el swing (default 2)
 * @returns {Array<{price:number, epoch:number, index:number}>} — últimos 3 swings
 */
function findSwingPoints(candles, type = 'high', lookback = 2) {
  const points = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const val = type === 'high' ? candles[i].high : candles[i].low;
    let isSwing = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      const cmp = type === 'high' ? candles[j].high : candles[j].low;
      if (type === 'high' && cmp >= val) { isSwing = false; break; }
      if (type === 'low'  && cmp <= val) { isSwing = false; break; }
    }
    if (isSwing) points.push({ price: val, epoch: candles[i].epoch, index: i });
  }
  // Devolver los últimos 3 (más recientes)
  return points.slice(-3);
}

/**
 * Calcula la franja de reacción histórica a partir de swing points.
 * Agrega un buffer del 0.15% a cada lado.
 *
 * @param {Array<{price:number}>} swingPoints
 * @param {number} bufferPct — buffer porcentual (default 0.0015 = 0.15%)
 * @returns {{ min:number, max:number, mid:number, count:number } | null}
 */
function calcReactionZone(swingPoints, bufferPct = 0.0015) {
  if (!swingPoints || swingPoints.length < 2) return null;
  const prices = swingPoints.map(p => p.price);
  const rawMin = Math.min(...prices);
  const rawMax = Math.max(...prices);
  const mid    = prices.reduce((a, b) => a + b, 0) / prices.length;
  return {
    min:   parseFloat((rawMin * (1 - bufferPct)).toFixed(5)),
    max:   parseFloat((rawMax * (1 + bufferPct)).toFixed(5)),
    mid:   parseFloat(mid.toFixed(5)),
    count: swingPoints.length,
    levels: prices.map(p => parseFloat(p.toFixed(5))),
  };
}

/**
 * Determina si el precio actual está dentro de la zona de reacción.
 *
 * @param {number} currentPrice
 * @param {{ min:number, max:number } | null} zone
 * @returns {boolean}
 */
function isPriceInZone(currentPrice, zone) {
  if (!zone) return false;
  return currentPrice >= zone.min && currentPrice <= zone.max;
}

/**
 * Analiza zonas de soporte/resistencia para un símbolo dado.
 * Para CRASH busca swing highs (techos de rechazo).
 * Para BOOM  busca swing lows  (pisos de rebote).
 *
 * @param {Array<{high,low,close,epoch}>} candles1H — candles 1H recientes
 * @param {'crash'|'boom'} type
 * @param {number} currentPrice
 * @returns {{
 *   swingPoints: Array,
 *   zone: { min, max, mid, count, levels } | null,
 *   priceInZone: boolean,
 *   distancePct: number | null,
 *   limitEntry: number | null,
 * }}
 */
function analyzeReactionZone(candles1H, type, currentPrice) {
  const swingType   = type === 'crash' ? 'high' : 'low';
  const swingPoints = findSwingPoints(candles1H, swingType, 2);
  const zone        = calcReactionZone(swingPoints);
  const priceInZone = isPriceInZone(currentPrice, zone);

  // Distancia del precio actual al mid de la zona (%)
  let distancePct = null;
  if (zone) {
    distancePct = parseFloat((((currentPrice - zone.mid) / zone.mid) * 100).toFixed(3));
  }

  // Precio de entrada límite sugerido: borde de la zona más cercano al precio
  let limitEntry = null;
  if (zone) {
    if (type === 'crash') {
      // SELL LIMIT en el borde superior de la zona (resistencia)
      limitEntry = parseFloat(zone.max.toFixed(5));
    } else {
      // BUY LIMIT en el borde inferior de la zona (soporte)
      limitEntry = parseFloat(zone.min.toFixed(5));
    }
  }

  return { swingPoints, zone, priceInZone, distancePct, limitEntry };
}

module.exports = {
  calcStoch,
  getLastStoch,
  checkEntryCondition,
  extractStochFeatures,
  calcSlope,
  findSwingPoints,
  calcReactionZone,
  isPriceInZone,
  analyzeReactionZone,
  MIN_CANDLES,
  STOCH_K_PERIOD,
  STOCH_SMOOTH,
  STOCH_D_PERIOD,
};
