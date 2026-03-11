import type { Candle, StochResult } from './types'

// ─── SMA helper ───────────────────────────────────────────────────────────────
export function sma(values: number[], period: number): number[] {
  const result: number[] = []
  for (let i = period - 1; i < values.length; i++) {
    const slice = values.slice(i - period + 1, i + 1)
    result.push(slice.reduce((a, b) => a + b, 0) / period)
  }
  return result
}

// ─── EMA helper ───────────────────────────────────────────────────────────────
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const ema: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) {
    ema.push(values[i] * k + ema[i - 1] * (1 - k))
  }
  return ema
}

// ─── Stochastic 5,3,3 ─────────────────────────────────────────────────────────
export function calculateStochastic(
  candles: Candle[],
  kPeriod = 5,
  dPeriod = 3,
  smooth = 3,
): StochResult {
  if (candles.length < kPeriod + smooth + dPeriod) {
    return { k: [], d: [] }
  }

  const rawK: number[] = []
  for (let i = kPeriod - 1; i < candles.length; i++) {
    const slice = candles.slice(i - kPeriod + 1, i + 1)
    const high = Math.max(...slice.map((c) => c.high))
    const low = Math.min(...slice.map((c) => c.low))
    const close = candles[i].close
    const range = high - low
    rawK.push(range === 0 ? 50 : ((close - low) / range) * 100)
  }

  const smoothK = sma(rawK, smooth)
  const smoothD = sma(smoothK, dPeriod)

  return { k: smoothK, d: smoothD }
}

// ─── Cross detection (any direction) ──────────────────────────────────────────
export function detectCross(kValues: number[], dValues: number[]): boolean {
  const len = Math.min(kValues.length, dValues.length)
  if (len < 2) return false
  const prevKAboveD = kValues[len - 2] > dValues[len - 2]
  const currKAboveD = kValues[len - 1] > dValues[len - 1]
  return prevKAboveD !== currKAboveD
}

// ─── Bearish cross: K was above D, now K crossed below D ──────────────────────
export function detectBearishCross(kValues: number[], dValues: number[]): boolean {
  const len = Math.min(kValues.length, dValues.length)
  if (len < 2) return false
  const prevKAboveD = kValues[len - 2] >= dValues[len - 2]
  const currKBelowD = kValues[len - 1] < dValues[len - 1]
  return prevKAboveD && currKBelowD
}

// ─── Bullish cross: K was below D, now K crossed above D ──────────────────────
export function detectBullishCross(kValues: number[], dValues: number[]): boolean {
  const len = Math.min(kValues.length, dValues.length)
  if (len < 2) return false
  const prevKBelowD = kValues[len - 2] <= dValues[len - 2]
  const currKAboveD = kValues[len - 1] > dValues[len - 1]
  return prevKBelowD && currKAboveD
}

// ─── Stoch zone ───────────────────────────────────────────────────────────────
export function getStochZone(k: number): 'SOBRECOMPRA' | 'NEUTRAL' | 'SOBREVENTA' {
  if (k >= 80) return 'SOBRECOMPRA'
  if (k <= 20) return 'SOBREVENTA'
  return 'NEUTRAL'
}

// ─── EMA trend ────────────────────────────────────────────────────────────────
export function getEMATrend(
  ema20: number,
  ema50: number,
): 'BEARISH' | 'BULLISH' | 'NEUTRAL' {
  const diff = Math.abs(ema20 - ema50) / ema50
  if (diff < 0.001) return 'NEUTRAL'
  return ema20 > ema50 ? 'BULLISH' : 'BEARISH'
}

export function getTrend(
  ema20: number,
  ema50: number,
): 'BAJISTA' | 'ALCISTA' | 'LATERAL' {
  const diff = Math.abs(ema20 - ema50) / ema50
  if (diff < 0.001) return 'LATERAL'
  return ema20 > ema50 ? 'ALCISTA' : 'BAJISTA'
}

// ─── Full signal validation ───────────────────────────────────────────────────
export interface SignalCheck {
  isValid: boolean
  confluencia1H: boolean
  confluencia15M: boolean
  confluencia5M: boolean
  cruce1H: boolean      // K/D bearish cross on H1 (CRASH) or bullish cross on H1 (BOOM)
  tendenciaCumple: boolean
}

export function validateSignal(
  tipo: 'CRASH' | 'BOOM',
  stoch1H: StochResult,
  stoch15M: StochResult,
  stoch5M: StochResult,
  trend: 'BAJISTA' | 'ALCISTA' | 'LATERAL',
): SignalCheck {
  const last = (arr: number[]) => arr[arr.length - 1] ?? 0

  const k1H  = last(stoch1H.k);   const d1H  = last(stoch1H.d)
  const k15M = last(stoch15M.k);  const d15M = last(stoch15M.d)
  const k5M  = last(stoch5M.k);   const d5M  = last(stoch5M.d)

  if (tipo === 'CRASH') {
    // Both K AND D must be overbought (>80) on every timeframe
    const confluencia1H  = k1H  > 80 && d1H  > 80
    const confluencia15M = k15M > 80 && d15M > 80
    const confluencia5M  = k5M  > 80 && d5M  > 80
    // H1 bearish cross: K just crossed below D on the 1H chart (trend reversal signal)
    const cruce1H = detectBearishCross(stoch1H.k, stoch1H.d)
    const tendenciaCumple = trend === 'BAJISTA'

    return {
      isValid: confluencia1H && confluencia15M && confluencia5M && cruce1H && tendenciaCumple,
      confluencia1H,
      confluencia15M,
      confluencia5M,
      cruce1H,
      tendenciaCumple,
    }
  } else {
    // Both K AND D must be oversold (<20) on every timeframe
    const confluencia1H  = k1H  < 20 && d1H  < 20
    const confluencia15M = k15M < 20 && d15M < 20
    const confluencia5M  = k5M  < 20 && d5M  < 20
    // H1 bullish cross: K just crossed above D on the 1H chart (trend reversal signal)
    const cruce1H = detectBullishCross(stoch1H.k, stoch1H.d)
    const tendenciaCumple = trend === 'ALCISTA'

    return {
      isValid: confluencia1H && confluencia15M && confluencia5M && cruce1H && tendenciaCumple,
      confluencia1H,
      confluencia15M,
      confluencia5M,
      cruce1H,
      tendenciaCumple,
    }
  }
}
