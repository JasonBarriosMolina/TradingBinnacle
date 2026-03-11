import WebSocket from 'ws'

const DERIV_APP_ID = process.env.DERIV_APP_ID!
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`

export interface DerivCandle {
  epoch: number
  open: number
  high: number
  low: number
  close: number
}

export interface DerivTrade {
  contract_id: number
  shortcode: string
  buy_price: number
  sell_price: number
  purchase_time: number   // epoch — entry time (Deriv calls this purchase_time)
  sell_time: number       // epoch — exit time
  underlying_symbol: string  // e.g. "BOOM300N", "CRASH500N"
  contract_type: string   // "ACCU", "CALL", "PUT", "BOOM", "CRASH", etc.
  // computed
  profit?: number         // sell_price - buy_price (not in API, we compute it)
  is_sold?: number        // not in profit_table (all entries are sold), kept for compat
}

function derivRequest<T = unknown>(token: string, payload: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)

    ws.on('open', () => {
      if (token) {
        // Authenticated: send authorize first; payload sent after auth response
        ws.send(JSON.stringify({ authorize: token }))
      } else {
        // Public market data (ticks_history etc.) — no auth required
        ws.send(JSON.stringify(payload))
      }
    })

    // If no token, we're already "authorized" (public request)
    let authorized = !token

    ws.on('message', (raw: Buffer) => {
      const data = JSON.parse(raw.toString())

      if (data.error) {
        ws.close()
        reject(new Error(data.error.message))
        return
      }

      if (data.authorize && !authorized) {
        authorized = true
        ws.send(JSON.stringify(payload))
        return
      }

      const key = Object.keys(payload)[0]
      // ticks_history requests come back with key "candles", not "ticks_history"
      const responseKey = key === 'ticks_history' ? 'candles' : key
      if (data[responseKey] !== undefined) {
        ws.close()
        resolve(data as T)
      }
    })

    ws.on('error', (e: Error) => {
      reject(e)
    })

    setTimeout(() => {
      ws.close()
      reject(new Error('Deriv WS timeout'))
    }, 30000)
  })
}

export interface CandleBatchRequest {
  symbol: string
  granularity: number
  count: number
}

export interface CandleBatchResult {
  symbol: string
  granularity: number
  candles: DerivCandle[]
}

/**
 * Fetch candles for multiple (symbol, granularity) combinations using a SINGLE
 * WebSocket connection multiplexed via req_id.  This avoids Deriv rate-limiting
 * that occurs when opening many concurrent WebSocket connections.
 */
export function getCandlesBatch(requests: CandleBatchRequest[]): Promise<CandleBatchResult[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    const results = new Map<number, CandleBatchResult>()
    let settled = false

    const finish = () => {
      if (settled) return
      settled = true
      ws.close()
      resolve(Array.from(results.values()))
    }

    ws.on('open', () => {
      requests.forEach((req, i) => {
        ws.send(JSON.stringify({
          ticks_history: req.symbol,
          style: 'candles',
          granularity: req.granularity,
          count: req.count,
          end: 'latest',
          req_id: i + 1,   // 1-based so req_id is always truthy
        }))
      })
    })

    ws.on('message', (raw: Buffer) => {
      const data = JSON.parse(raw.toString())
      const reqId: number = data.req_id ?? 0
      const req = requests[reqId - 1]
      if (!req) return

      if (data.error) {
        // Record an empty result for this request and keep waiting for others
        results.set(reqId, { symbol: req.symbol, granularity: req.granularity, candles: [] })
      } else if (data.candles) {
        results.set(reqId, {
          symbol: req.symbol,
          granularity: req.granularity,
          candles: (data.candles as Array<{ epoch: number; open: string; high: string; low: string; close: string }>).map((c) => ({
            epoch: c.epoch,
            open: parseFloat(c.open as unknown as string),
            high: parseFloat(c.high as unknown as string),
            low: parseFloat(c.low as unknown as string),
            close: parseFloat(c.close as unknown as string),
          })),
        })
      }

      if (results.size === requests.length) finish()
    })

    ws.on('error', (e: Error) => {
      if (!settled) { settled = true; ws.close(); reject(e) }
    })

    // If not all responses arrive in 30s, resolve with whatever we have
    setTimeout(() => finish(), 30000)
  })
}

export async function getCandles(
  token: string,
  symbol: string,
  granularity: number,
  count: number,
  endEpoch?: number,
): Promise<DerivCandle[]> {
  const res = await derivRequest<{ candles: Array<{ epoch: number; open: string; high: string; low: string; close: string }> }>(token, {
    ticks_history: symbol,
    style: 'candles',
    granularity,
    count,
    end: endEpoch ? String(endEpoch) : 'latest',
  })
  return (res.candles ?? []).map((c) => ({
    epoch: c.epoch,
    open: parseFloat(c.open as unknown as string),
    high: parseFloat(c.high as unknown as string),
    low: parseFloat(c.low as unknown as string),
    close: parseFloat(c.close as unknown as string),
  }))
}

export async function getProfitTable(
  token: string,
  limit = 100,
  opts: { offset?: number; dateFrom?: number; dateTo?: number } = {},
): Promise<DerivTrade[]> {
  const payload: Record<string, unknown> = {
    profit_table: 1,
    description: 1,
    limit,
    sort: 'DESC',
  }
  if (opts.offset)   payload.offset    = opts.offset
  if (opts.dateFrom) payload.date_from = opts.dateFrom
  if (opts.dateTo)   payload.date_to   = opts.dateTo

  const res = await derivRequest<{ profit_table: { transactions: DerivTrade[] } }>(token, payload)
  return res.profit_table?.transactions ?? []
}

/** Fetch ALL sold trades in the last `days` days using offset-based pagination.
 *  Deriv profit_table max limit is 500 per request. */
export async function getAllTradesInRange(token: string, days = 30): Promise<DerivTrade[]> {
  const dateFrom = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60
  const allTrades: DerivTrade[] = []
  const PAGE = 500   // Deriv max is 500 per request
  let offset = 0

  while (true) {
    const page = await getProfitTable(token, PAGE, { dateFrom, offset })
    allTrades.push(...page)
    if (page.length < PAGE) break   // last page
    offset += PAGE
    if (allTrades.length >= 5000) break  // safety cap
  }

  return allTrades
}

export async function getAccountBalance(token: string): Promise<{ balance: number; currency: string; loginid: string }> {
  const res = await derivRequest<{ authorize: { balance: number; currency: string; loginid: string } }>(token, {
    authorize: token,
  })
  return {
    balance: res.authorize.balance,
    currency: res.authorize.currency,
    loginid: res.authorize.loginid,
  }
}
