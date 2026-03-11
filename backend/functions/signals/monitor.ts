import type { EventBridgeHandler } from 'aws-lambda'
import webpush from 'web-push'
import { putItem, scanItems, TABLES } from '../../lib/dynamo'
import { getCandlesBatch } from '../../lib/deriv'
import {
  calculateStochastic,
  calculateEMA,
  getTrend,
  validateSignal,
} from '../../stoch/calculator'
import type { Signal, User, IndexSymbol, Candle } from '../../../shared/types'
import { DERIV_SYMBOLS } from '../../../shared/types'

webpush.setVapidDetails(
  process.env.VAPID_EMAIL!,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!,
)

const INDICES: IndexSymbol[] = [
  'CRASH_300', 'CRASH_500', 'CRASH_600', 'CRASH_900', 'CRASH_1000',
  'BOOM_300',  'BOOM_500',  'BOOM_600',  'BOOM_900',  'BOOM_1000',
]

// This Lambda runs on EventBridge every 1 minute.
// All 30 candle requests (10 indices × 3 timeframes) are sent through a SINGLE
// WebSocket connection to avoid Deriv rate-limiting that occurs with many parallel connections.
export const handler: EventBridgeHandler<'Scheduled Event', unknown, void> = async () => {
  // Build all requests: 10 indices × 3 timeframes = 30 requests
  const requests = INDICES.flatMap((index) => {
    const symbol = DERIV_SYMBOLS[index]
    return [
      { symbol, granularity: 3600, count: 60 },   // 1H
      { symbol, granularity: 900,  count: 80 },   // 15M
      { symbol, granularity: 300,  count: 80 },   // 5M
    ]
  })

  // Single WS connection — all responses arrive through the same socket
  const batchResults = await getCandlesBatch(requests)

  // Index results by symbol+granularity for fast lookup
  const candleMap = new Map<string, typeof batchResults[0]['candles']>()
  for (const r of batchResults) {
    candleMap.set(`${r.symbol}:${r.granularity}`, r.candles)
  }

  // Check each index with the pre-fetched candle data
  for (const index of INDICES) {
    try {
      const symbol = DERIV_SYMBOLS[index]
      const raw1H = candleMap.get(`${symbol}:3600`) ?? []
      const raw15M = candleMap.get(`${symbol}:900`)  ?? []
      const raw5M  = candleMap.get(`${symbol}:300`)  ?? []

      if (raw1H.length < 20 || raw15M.length < 5 || raw5M.length < 5) continue

      await processIndex(index, symbol, raw1H, raw15M, raw5M)
    } catch (err) {
      console.error(`Error checking signal for ${index}:`, err)
    }
  }
}

const toCandle = (c: { epoch: number; open: number; high: number; low: number; close: number }): Candle => ({
  time: c.epoch, open: c.open, high: c.high, low: c.low, close: c.close,
})

async function processIndex(
  index: IndexSymbol,
  _symbol: string,
  raw1H: { epoch: number; open: number; high: number; low: number; close: number }[],
  raw15M: { epoch: number; open: number; high: number; low: number; close: number }[],
  raw5M:  { epoch: number; open: number; high: number; low: number; close: number }[],
): Promise<void> {
  const tipo = index.startsWith('CRASH') ? 'CRASH' : 'BOOM'

  const stoch1H = calculateStochastic(raw1H.map(toCandle))
  const stoch15M = calculateStochastic(raw15M.map(toCandle))
  const stoch5M = calculateStochastic(raw5M.map(toCandle))

  const closes = raw1H.map((c) => c.close)
  const ema20 = calculateEMA(closes, 20)
  const ema50 = calculateEMA(closes, 50)
  const lastEMA20 = ema20[ema20.length - 1]
  const lastEMA50 = ema50[ema50.length - 1]
  const trend = getTrend(lastEMA20, lastEMA50)

  const validation = validateSignal(tipo, stoch1H, stoch15M, stoch5M, trend)
  if (!validation.isValid) return

  const last = <T>(arr: T[]) => arr[arr.length - 1]
  const signal: Signal = {
    indice: index,
    tipo,
    stoch1H_K: last(stoch1H.k),
    stoch1H_D: last(stoch1H.d),
    stoch15M_K: last(stoch15M.k),
    stoch15M_D: last(stoch15M.d),
    stoch5M_K: last(stoch5M.k),
    stoch5M_D: last(stoch5M.d),
    tendencia: trend,
    ema20: lastEMA20,
    ema50: lastEMA50,
    precioActual: last(raw5M).close,
    timestamp: new Date().toISOString(),
    notificadoA: [],
  }

  const ts = signal.timestamp
  await putItem(TABLES.SIGNALS, { PK: 'SIGNAL', SK: `${ts}#${index}`, ...signal })

  await notifyProUsers(signal)
}

async function notifyProUsers(signal: Signal): Promise<void> {
  const allUsers = await scanItems<User & { PK: string }>(({ TableName: TABLES.USERS } as Parameters<typeof scanItems>[0]))

  const proUsers = allUsers.filter(
    (u) => u.plan === 'pro' && (u.status === 'active' || u.status === 'trial'),
  )

  const emoji = signal.tipo === 'CRASH' ? '🔴' : '🟢'
  const accion = signal.tipo === 'CRASH' ? 'SELL' : 'BUY'
  const indexLabel = signal.indice.replace('_', ' ')

  for (const user of proUsers) {
    const watches = user.watchlist ?? []
    if (!watches.includes(signal.indice)) continue
    if (!user.pushSubscription) continue

    try {
      await webpush.sendNotification(
        user.pushSubscription as webpush.PushSubscription,
        JSON.stringify({
          title: `${emoji} Señal ${signal.tipo} — ${indexLabel}`,
          body: `${accion} | Stoch 1H:${signal.stoch1H_K.toFixed(1)} 15M:${signal.stoch15M_K.toFixed(1)} 5M:${signal.stoch5M_K.toFixed(1)} | ${signal.tendencia}`,
          icon: '/icon-192.png',
          badge: '/badge-72.png',
          data: { url: '/signals' },
        }),
      )
    } catch (err) {
      console.error('Push error for user', user.PK, err)
    }
  }
}
