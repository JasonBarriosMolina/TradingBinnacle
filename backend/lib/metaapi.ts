// ─── MetaApi REST Client ──────────────────────────────────────────────────────
// Docs: https://metaapi.cloud/docs/client/

const METAAPI_TOKEN = process.env.METAAPI_TOKEN!
const BASE_PROV   = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const BASE_CLIENT = 'https://mt-client-api-v1.london.agiliumtrade.ai'

const headers = () => ({
  'auth-token':   METAAPI_TOKEN,
  'Content-Type': 'application/json',
})

async function request<T = unknown>(
  base: string,
  path: string,
  method: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`MetaApi ${method} ${path} → ${res.status}: ${text}`)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

// ─── Account provisioning ─────────────────────────────────────────────────────

export interface MetaApiAccount {
  id: string
  connectionStatus: string
  state: string
  region: string
}

/** Create a new MT5 account in MetaApi cloud. Returns the accountId. */
export async function provisionAccount(
  login: string,
  password: string,
  server: string,
  name: string,
): Promise<string> {
  const body = {
    login,
    password,
    name,
    server,
    platform:    'mt5',
    type:        'cloud-g2',
    magic:       0,
    application: 'MetaApi',
    reliability: 'regular',
    region:      'london',
    manualTrades: false,
    quoteStreamingIntervalInSeconds: 2.5,
  }
  const res = await request<{ id: string }>(BASE_PROV, '/users/current/accounts', 'POST', body)
  return res.id
}

/** Delete an MT5 account from MetaApi cloud. */
export async function deleteAccount(accountId: string): Promise<void> {
  await request(BASE_PROV, `/users/current/accounts/${accountId}`, 'DELETE')
}

/** Deploy (start) a terminal — needed before pulling data. */
export async function deployAccount(accountId: string): Promise<void> {
  await request(BASE_PROV, `/users/current/accounts/${accountId}/deploy`, 'POST')
}

/** Undeploy (stop) a terminal — call after pulling data to save costs. */
export async function undeployAccount(accountId: string): Promise<void> {
  await request(BASE_PROV, `/users/current/accounts/${accountId}/undeploy`, 'POST')
}

/** Get account info including connectionStatus. */
export async function getAccount(accountId: string): Promise<MetaApiAccount> {
  return request<MetaApiAccount>(BASE_PROV, `/users/current/accounts/${accountId}`, 'GET')
}

/** Wait until account is CONNECTED (up to timeoutMs). */
export async function waitConnected(accountId: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const acct = await getAccount(accountId)
    if (acct.connectionStatus === 'CONNECTED') return
    await new Promise((r) => setTimeout(r, 3000))
  }
  throw new Error(`MetaApi account ${accountId} did not connect within ${timeoutMs}ms`)
}

// ─── Deal history ─────────────────────────────────────────────────────────────

export interface MetaApiDeal {
  id: string
  platform: string
  type: string          // DEAL_TYPE_BUY | DEAL_TYPE_SELL
  entryType: string     // DEAL_ENTRY_IN | DEAL_ENTRY_OUT
  symbol: string        // e.g. "Crash 1000 Index"
  time: string          // ISO8601
  brokerTime: string
  price: number
  profit: number
  volume: number        // lots
  positionId: string
  commission: number
  swap: number
  comment?: string
  reason?: string
}

// ─── Historical candle data ────────────────────────────────────────────────────

export interface MetaApiCandle {
  time: string       // ISO8601 UTC
  brokerTime?: string
  open: number
  high: number
  low: number
  close: number
  tickVolume?: number
}

const TIMEFRAME_MAP: Record<number, string> = {
  1: '1m', 5: '5m', 15: '15m', 60: '1h', 240: '4h', 1440: '1d',
}

/**
 * Fetch historical OHLC candles for a symbol.
 * Account MUST be deployed + connected before calling this.
 * @param startTimeMs  Unix ms — the earliest candle time to return
 * @param count        Max number of candles to return
 */
export async function getCandles(
  accountId: string,
  symbol: string,
  timeframeMinutes: number,
  count: number,
  startTimeMs: number,
): Promise<MetaApiCandle[]> {
  const tf = TIMEFRAME_MAP[timeframeMinutes] ?? '5m'
  const startIso = new Date(startTimeMs).toISOString()
  const path =
    `/users/current/accounts/${encodeURIComponent(accountId)}` +
    `/historical-market-data/symbols/${encodeURIComponent(symbol)}` +
    `/timeframes/${tf}/candles` +
    `?startTime=${encodeURIComponent(startIso)}&limit=${count}`
  return request<MetaApiCandle[]>(BASE_CLIENT, path, 'GET')
}

// ─── Deal history ─────────────────────────────────────────────────────────────

/** Fetch deal history for a given time range. */
export async function getDeals(
  accountId: string,
  startIso: string,
  endIso: string,
): Promise<MetaApiDeal[]> {
  return request<MetaApiDeal[]>(
    BASE_CLIENT,
    `/users/current/accounts/${accountId}/history-deals/time` +
      `/${encodeURIComponent(startIso)}/${encodeURIComponent(endIso)}`,
    'GET',
  )
}
