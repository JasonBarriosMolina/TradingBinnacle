import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda'
import { queryItems, getItem, TABLES } from '../../lib/dynamo'
import { ok, err, getUserId } from '../../lib/lambda'
import { getCandles } from '../../lib/deriv'
import type { Trade } from '../../../shared/types'
import { DERIV_SYMBOLS } from '../../../shared/types'

const PAGE_SIZE = 20

// GET /trades
export const list = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const { indice, resultado, fecha, page = '1' } = event.queryStringParameters ?? {}
    const pageNum = parseInt(page as string)

    const allTrades = await queryItems<Trade & { PK: string; SK: string }>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': 'TRADE#' },
      ScanIndexForward: false, // Most recent first
    })

    // Client-side filters (DynamoDB FilterExpression would need GSI for efficiency)
    let filtered = allTrades
    if (indice) filtered = filtered.filter((t) => t.indice === indice)
    if (resultado) filtered = filtered.filter((t) => t.resultado === resultado)
    if (fecha) filtered = filtered.filter((t) => t.fecha === fecha)

    const total = filtered.length
    const start = (pageNum - 1) * PAGE_SIZE
    const trades = filtered.slice(start, start + PAGE_SIZE).map(({ PK, SK, ...t }) => t)

    return ok({ trades, total, hasMore: start + PAGE_SIZE < total })
  } catch (e) {
    console.error(e)
    return err('Error obteniendo trades', 500)
  }
}

// GET /trades/:tradeId
export const getOne = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const tradeId = event.pathParameters?.tradeId
    if (!tradeId) return err('tradeId requerido', 400)

    const allTrades = await queryItems<Trade & { PK: string; SK: string }>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': `TRADE#${tradeId}#` },
    })

    if (allTrades.length === 0) return err('Trade no encontrado', 404)
    const { PK, SK, ...trade } = allTrades[0]
    return ok(trade)
  } catch (e) {
    console.error(e)
    return err('Error', 500)
  }
}

// GET /trades/{tradeId}/candles — returns 5M historical candles for the trade chart
export const getTradeCandles = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const tradeId = event.pathParameters?.tradeId
    if (!tradeId) return err('tradeId requerido', 400)

    // Find trade in DynamoDB
    const allTrades = await queryItems<Trade & { PK: string; SK: string }>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': `TRADE#${tradeId}#` },
    })

    if (allTrades.length === 0) return err('Trade no encontrado', 404)
    const trade = allTrades[0]

    const derivSymbol = DERIV_SYMBOLS[trade.indice]
    if (!derivSymbol) return err('Símbolo no soportado', 400)

    // Convert entry/exit ISO timestamps → Unix epoch (seconds)
    const entryEpoch = Math.floor(new Date(trade.horaEntrada).getTime() / 1000)
    const exitEpoch  = trade.horaCierre
      ? Math.floor(new Date(trade.horaCierre).getTime() / 1000)
      : undefined

    // Fetch 80 × 5M candles centered around the entry:
    // end = entryEpoch + 40 × 300s → shows 40 candles before entry and 40 after
    const endEpoch = entryEpoch + 40 * 300
    const rawCandles = await getCandles('', derivSymbol, 300, 80, endEpoch)

    const candles = rawCandles.map((c) => ({
      time: c.epoch,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))

    return ok({ candles, entryEpoch, exitEpoch, entryPrice: trade.precioEntrada, exitPrice: trade.precioCierre })
  } catch (e) {
    console.error('getTradeCandles error:', e)
    return err('Error obteniendo candles', 500)
  }
}

// GET /stats
export const stats = async (event: APIGatewayProxyEventV2WithJWTAuthorizer) => {
  try {
    const userId = getUserId(event)
    if (!userId) return err('No autorizado', 401)

    const allTrades = await queryItems<Trade>({
      TableName: TABLES.TRADES,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': userId, ':prefix': 'TRADE#' },
    })

    const total = allTrades.length
    if (total === 0) {
      return ok({
        winrateGeneral: 0, winratePorIndice: {}, winratePorDireccion: {},
        winrateConSenal: 0, winrateSinSenal: 0, pnlTotal: 0,
        pnlPorSemana: [], pnlPorMes: [],
        mejorTrade: null, peorTrade: null, totalTrades: 0, tradesConStoch: 0,
      })
    }

    const wins = allTrades.filter((t) => t.resultado === 'WIN').length
    const winrateGeneral = wins / total

    // By index
    const indices = [
      'CRASH_300', 'CRASH_500', 'CRASH_600', 'CRASH_900', 'CRASH_1000',
      'BOOM_300',  'BOOM_500',  'BOOM_600',  'BOOM_900',  'BOOM_1000',
    ] as const
    const winratePorIndice = Object.fromEntries(
      indices.map((idx) => {
        const subset = allTrades.filter((t) => t.indice === idx)
        const w = subset.filter((t) => t.resultado === 'WIN').length
        return [idx, subset.length > 0 ? w / subset.length : 0]
      }),
    )

    // By direction
    const winratePorDireccion = {
      BUY: (() => {
        const s = allTrades.filter((t) => t.direccion === 'BUY')
        return s.length > 0 ? s.filter((t) => t.resultado === 'WIN').length / s.length : 0
      })(),
      SELL: (() => {
        const s = allTrades.filter((t) => t.direccion === 'SELL')
        return s.length > 0 ? s.filter((t) => t.resultado === 'WIN').length / s.length : 0
      })(),
    }

    // Signal accuracy
    const withSignal = allTrades.filter((t) => t.senalValida)
    const withoutSignal = allTrades.filter((t) => !t.senalValida)
    const winrateConSenal = withSignal.length > 0 ? withSignal.filter((t) => t.resultado === 'WIN').length / withSignal.length : 0
    const winrateSinSenal = withoutSignal.length > 0 ? withoutSignal.filter((t) => t.resultado === 'WIN').length / withoutSignal.length : 0

    const pnlTotal = allTrades.reduce((s, t) => s + t.gananciaUSD, 0)

    // Weekly P&L — last 4 ISO weeks (Mon–Sun), always pre-populated with 0
    // Label format: "3 mar '26" — day, short month, 2-digit year
    function getMondayOf(d: Date): Date {
      const day = d.getDay()                    // 0=Sun, 1=Mon … 6=Sat
      const diff = day === 0 ? -6 : 1 - day    // days to subtract to reach Mon
      const mon = new Date(d)
      mon.setDate(d.getDate() + diff)
      mon.setHours(0, 0, 0, 0)
      return mon
    }
    const MONTH_NAMES = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']
    function weekLabel(mon: Date): string {
      return `${mon.getDate()} ${MONTH_NAMES[mon.getMonth()]} '${String(mon.getFullYear()).slice(-2)}`
    }

    // Build the 4 most-recent Monday keys in chronological order
    const now = new Date()
    const weekKeys: string[] = []
    const seenKeys = new Set<string>()
    for (let i = 3; i >= 0; i--) {
      const ref = new Date(now.getTime() - i * 7 * 24 * 60 * 60 * 1000)
      const mon = getMondayOf(ref)
      const label = weekLabel(mon)
      if (!seenKeys.has(label)) { seenKeys.add(label); weekKeys.push(label) }
    }

    // Pre-populate map with 0 so every week slot always exists
    const weeklyMap = new Map<string, number>(weekKeys.map((k) => [k, 0]))

    // Only count trades from the last 28 days (4 weeks)
    const cutoff28 = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000)
    allTrades
      .filter((t) => new Date(t.fecha) >= cutoff28)
      .forEach((t) => {
        const mon = getMondayOf(new Date(t.fecha))
        const label = weekLabel(mon)
        weeklyMap.set(label, (weeklyMap.get(label) ?? 0) + t.gananciaUSD)
      })

    const pnlPorSemana = weekKeys.map((week) => ({ week, pnl: weeklyMap.get(week) ?? 0 }))

    // Monthly P&L
    const monthlyMap = new Map<string, number>()
    allTrades.forEach((t) => {
      const d = new Date(t.fecha)
      const month = d.toLocaleString('es', { month: 'short', year: '2-digit' })
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + t.gananciaUSD)
    })
    const pnlPorMes = [...monthlyMap.entries()].map(([month, pnl]) => ({ month, pnl })).slice(-6)

    const sorted = [...allTrades].sort((a, b) => b.gananciaUSD - a.gananciaUSD)
    const mejorTrade = sorted[0] ?? null
    const peorTrade = sorted[sorted.length - 1] ?? null
    const tradesConStoch = allTrades.filter((t) => t.stochCruce).length

    return ok({
      winrateGeneral, winratePorIndice, winratePorDireccion,
      winrateConSenal, winrateSinSenal, pnlTotal,
      pnlPorSemana, pnlPorMes,
      mejorTrade, peorTrade, totalTrades: total, tradesConStoch,
    })
  } catch (e) {
    console.error(e)
    return err('Error calculando estadísticas', 500)
  }
}
