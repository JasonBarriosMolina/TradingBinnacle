import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { v4 as uuid } from 'uuid'
import { getItem, putItem, queryItems, updateItem, TABLES } from '../../lib/dynamo'
import { getCandles, getProfitTable, getAllTradesInRange, type DerivTrade } from '../../lib/deriv'
import { decryptToken } from '../../lib/auth'
import { ok, err, getUserId } from '../../lib/lambda'
import {
  calculateStochastic,
  calculateEMA,
  detectCross,
  getStochZone,
  getTrend,
  getEMATrend,
  validateSignal,
} from '../../stoch/calculator'
import type { User, Trade, IndexSymbol, Candle } from '../../../shared/types'
import { DERIV_SYMBOLS } from '../../../shared/types'

const DERIV_TO_INDEX: Record<string, IndexSymbol> = {
  // Current Deriv API symbols (with N suffix = new indices)
  'CRASH300N':  'CRASH_300',
  'CRASH500N':  'CRASH_500',
  'CRASH600N':  'CRASH_600',
  'CRASH900N':  'CRASH_900',
  'CRASH1000N': 'CRASH_1000',
  'BOOM300N':   'BOOM_300',
  'BOOM500N':   'BOOM_500',
  'BOOM600N':   'BOOM_600',
  'BOOM900N':   'BOOM_900',
  'BOOM1000N':  'BOOM_1000',
  // Without N suffix (older contracts / backward compatibility)
  'CRASH300':  'CRASH_300',
  'CRASH500':  'CRASH_500',
  'CRASH600':  'CRASH_600',
  'CRASH900':  'CRASH_900',
  'CRASH1000': 'CRASH_1000',
  'BOOM300':   'BOOM_300',
  'BOOM500':   'BOOM_500',
  'BOOM600':   'BOOM_600',
  'BOOM900':   'BOOM_900',
  'BOOM1000':  'BOOM_1000',
  // Legacy symbols
  '1HZ100V': 'CRASH_500',
  '1HZ50V':  'BOOM_500',
}

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string; derivToken?: string }>(TABLES.USERS, { PK: userId, SK: 'PROFILE' })
    if (!user?.derivToken) return err('Cuenta Deriv no conectada', 400)

    const token = decryptToken(user.derivToken)

    // Get existing trade IDs
    const existing = await queryItems<{ SK: string }>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': 'TRADE#' },
      ProjectionExpression: 'SK',
    })
    const existingIds = new Set(existing.map((e) => e.SK.split('#')[1]))

    // Fetch trades from Deriv
    const derivTrades = await getProfitTable(token, 200)
    // profit_table only returns closed contracts — no is_sold check needed
    const newTrades = derivTrades.filter(
      (t) => !existingIds.has(String(t.contract_id)),
    )

    if (newTrades.length === 0) return ok({ synced: 0, trades: [] })

    const processed: Trade[] = []

    for (const dt of newTrades.slice(0, 50)) {
      try {
        const trade = await processTrade(userId, token, dt, user)
        if (trade) {
          const sk = `TRADE#${trade.tradeId}#${trade.horaEntrada}`
          await putItem(TABLES.TRADES, { PK: userId, SK: sk, ...trade })
          processed.push(trade)
        }
      } catch (e) {
        console.error('Error processing trade', dt.contract_id, e)
      }
    }

    return ok({ synced: processed.length, trades: processed })
  } catch (e) {
    console.error(e)
    return err('Error sincronizando trades', 500)
  }
}

// ─── POST /trades/sync-history ───────────────────────────────────────────────
// Imports up to 30 days of closed trades from Deriv without candle analysis.
// Much faster than the regular sync (no WS calls per trade).
export const historySync = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string; derivToken?: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (!user?.derivToken) return err('Cuenta Deriv no conectada', 400)

    const token = decryptToken(user.derivToken)

    // Load existing trade IDs to avoid duplicates
    const existing = await queryItems<{ SK: string }>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': 'TRADE#' },
      ProjectionExpression: 'SK',
    })
    const existingIds = new Set(existing.map((e) => e.SK.split('#')[1]))

    // Fetch all trades from last 30 days (paginated, single WS per page)
    const allDerivTrades = await getAllTradesInRange(token, 30)
    // profit_table only returns closed contracts — no is_sold check needed
    const newTrades = allDerivTrades.filter(
      (t) => !existingIds.has(String(t.contract_id)),
    )

    let synced = 0
    const errors: number[] = []

    for (const dt of newTrades) {
      try {
        const trade = buildHistoricalTrade(userId, dt, user)
        if (!trade) continue
        const sk = `TRADE#${trade.tradeId}#${trade.horaEntrada}`
        await putItem(TABLES.TRADES, { PK: userId, SK: sk, ...trade })
        synced++
      } catch (e) {
        console.error('Error saving trade', dt.contract_id, e)
        errors.push(dt.contract_id)
      }
    }

    console.log(`[historySync] user=${userId} total=${allDerivTrades.length} new=${newTrades.length} saved=${synced}`)
    return ok({
      synced,
      total: allDerivTrades.length,
      skipped: allDerivTrades.length - newTrades.length,
      errors: errors.length,
    })
  } catch (e) {
    console.error('[historySync] error:', e)
    return err('Error importando historial', 500)
  }
}

/** Build a Trade from raw Deriv data — no candle/stochastic analysis */
function buildHistoricalTrade(
  userId: string,
  dt: DerivTrade,
  user: User,
): Trade | null {
  // Deriv uses underlying_symbol (e.g. "BOOM300N"), not "underlying"
  const sym = dt.underlying_symbol
  const indexSymbol = DERIV_TO_INDEX[sym]
  if (!indexSymbol) return null   // unknown symbol (forex, crypto, etc.) → skip

  // Direction: BOOM/CALL = BUY (price goes up), CRASH/PUT = SELL (price goes down)
  // ACCU contracts: underlying symbol tells us the direction
  const isBoom = sym.startsWith('BOOM')
  const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL'

  // Deriv uses purchase_time (not buy_time)
  const entryTime = dt.purchase_time
  const exitTime  = dt.sell_time
  const profit    = dt.sell_price - dt.buy_price   // not returned directly by API

  return {
    tradeId:          String(dt.contract_id),
    userId,
    fecha:            new Date(entryTime * 1000).toISOString().split('T')[0],
    horaEntrada:      new Date(entryTime * 1000).toISOString(),
    horaCierre:       new Date(exitTime  * 1000).toISOString(),
    duracionMinutos:  Math.round((exitTime - entryTime) / 60),
    cuenta:           (user.derivAccountType ?? 'demo') as 'demo' | 'real',
    indice:           indexSymbol,
    direccion:        direction,
    precioEntrada:    dt.buy_price,
    precioCierre:     dt.sell_price,
    stake:            dt.buy_price,
    gananciaUSD:      profit,
    resultado:        profit > 0 ? 'WIN' : 'LOSS',
    // Neutral stochastic defaults (no live candle data for historical trades)
    stochK_entrada:   50,
    stochD_entrada:   50,
    stochZona:        'NEUTRAL',
    stochCruce:       false,
    senalValida:      false,
    tendencia:        'LATERAL',
    ema20_vs_ema50:   'NEUTRAL',
    confluencia1H:    false,
    confluencia15M:   false,
    confluencia5M:    false,
    numeroDia:        1,
    balanceDia:       0,
    capitalInicial:   0,
  }
}

async function processTrade(
  userId: string,
  token: string,
  dt: DerivTrade,
  user: User,
): Promise<Trade | null> {
  // underlying_symbol is the correct field (e.g. "BOOM300N")
  const sym = dt.underlying_symbol
  const indexSymbol = DERIV_TO_INDEX[sym]
  if (!indexSymbol) return null

  const isBoom = sym.startsWith('BOOM')
  const direction: 'BUY' | 'SELL' = isBoom ? 'BUY' : 'SELL'
  const entryTime = dt.purchase_time   // Deriv uses purchase_time, not buy_time
  const exitTime  = dt.sell_time
  const duration  = Math.round((exitTime - entryTime) / 60)
  const profit    = dt.sell_price - dt.buy_price
  const isWin     = profit > 0

  const derivSymbol = DERIV_SYMBOLS[indexSymbol]

  // Stochastic defaults — used if candle fetch fails
  let kEntry5M = 50, dEntry5M = 50
  let hasCross = false
  let zone      = getStochZone(50)
  let trend     = 'LATERAL' as Trade['tendencia']
  let emaSig    = 'NEUTRAL' as Trade['ema20_vs_ema50']
  let validation = { isValid: false, confluencia1H: false, confluencia15M: false, confluencia5M: false }

  try {
    const toCandle = (c: { epoch: number; open: number; high: number; low: number; close: number }): Candle => ({
      time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close,
    })

    // Run all three candle fetches in parallel — faster than sequential
    const [candles5M, candles15M, candles1H] = await Promise.all([
      getCandles(token, derivSymbol, 300,  80),
      getCandles(token, derivSymbol, 900,  60),
      getCandles(token, derivSymbol, 3600, 50),
    ])

    const stoch5M  = calculateStochastic(candles5M.map(toCandle))
    const stoch15M = calculateStochastic(candles15M.map(toCandle))
    const stoch1H  = calculateStochastic(candles1H.map(toCandle))

    const closes1H  = candles1H.map((c) => c.close)
    const ema20arr  = calculateEMA(closes1H, 20)
    const ema50arr  = calculateEMA(closes1H, 50)
    const lastEMA20 = ema20arr[ema20arr.length - 1]
    const lastEMA50 = ema50arr[ema50arr.length - 1]

    kEntry5M  = stoch5M.k[stoch5M.k.length - 1] ?? 50
    dEntry5M  = stoch5M.d[stoch5M.d.length - 1] ?? 50
    hasCross  = detectCross(stoch5M.k, stoch5M.d)
    zone      = getStochZone(kEntry5M)
    trend     = getTrend(lastEMA20, lastEMA50)
    emaSig    = getEMATrend(lastEMA20, lastEMA50)

    const tipo = indexSymbol.startsWith('CRASH') ? 'CRASH' : 'BOOM'
    validation = validateSignal(tipo, stoch1H, stoch15M, stoch5M, trend)
  } catch (candleErr) {
    console.warn(`[sync] candle/stoch failed for ${dt.contract_id} (${derivSymbol}):`, String(candleErr))
  }

  const trade: Trade = {
    tradeId: String(dt.contract_id),
    userId,
    fecha: new Date(entryTime * 1000).toISOString().split('T')[0],
    horaEntrada: new Date(entryTime * 1000).toISOString(),
    horaCierre: new Date(exitTime * 1000).toISOString(),
    duracionMinutos: duration,
    cuenta: user.derivAccountType ?? 'demo',
    indice: indexSymbol,
    direccion: direction,
    precioEntrada: dt.buy_price,
    precioCierre: dt.sell_price,
    stake: dt.buy_price,
    gananciaUSD: profit,
    resultado: isWin ? 'WIN' : 'LOSS',
    stochK_entrada: kEntry5M,
    stochD_entrada: dEntry5M,
    stochZona: zone,
    stochCruce: hasCross,
    senalValida: validation.isValid,
    tendencia: trend,
    ema20_vs_ema50: emaSig,
    confluencia1H: validation.confluencia1H,
    confluencia15M: validation.confluencia15M,
    confluencia5M: validation.confluencia5M,
    numeroDia: 1, // Day number within trading plan — computed separately
    balanceDia: 0, // Computed from day trades
    capitalInicial: 0,
  }

  return trade
}
