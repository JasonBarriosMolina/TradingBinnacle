import type { APIGatewayProxyEventV2WithJWTAuthorizer, ScheduledEvent } from 'aws-lambda'
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda'
import { getItem, putItem, queryItems, updateItem, scanItems, TABLES } from '../../lib/dynamo'
import { deployAccount, undeployAccount, waitConnected, getDeals, getCandles } from '../../lib/metaapi'
import { ok, err, getUserId } from '../../lib/lambda'
import { calculateStochastic, getStochZone, detectCross } from '../../stoch/calculator'
import { MT5_TO_INDEX } from '../../../shared/types'
import type { User, Trade, IndexSymbol, Candle } from '../../../shared/types'

const lambdaClient = new LambdaClient({ region: process.env.AWS_REGION ?? 'us-east-1' })

// ─── Types ────────────────────────────────────────────────────────────────────

interface WorkerPayload {
  source: 'worker'
  userId: string
  windowMs: number
}

interface MT5Deal {
  id: string
  type: string       // DEAL_TYPE_BUY | DEAL_TYPE_SELL
  entryType: string  // DEAL_ENTRY_IN | DEAL_ENTRY_OUT
  symbol: string
  time: string
  price: number
  profit: number
  volume: number
  positionId: string
}

// ─── Safe date parser — handles ISO, broker-format, and numeric timestamps ────

function safeParseTime(raw: unknown): number {
  if (!raw) return Date.now()
  // Numeric Unix seconds (MetaApi sometimes returns seconds, not ms)
  if (typeof raw === 'number') {
    return raw > 1e10 ? raw : raw * 1000  // if < 10^10, assume seconds
  }
  const str = String(raw)
  // Replace broker-format "2024-01-15 10:30:00.000" → ISO-compatible
  const normalized = str.replace(' ', 'T')
  const t = new Date(normalized).getTime()
  if (isNaN(t)) {
    console.warn('[mt5sync] unparseable time field:', raw)
    return Date.now()
  }
  return t
}

// ─── Build Trade from MT5 deal pair ──────────────────────────────────────────

function buildMT5Trade(
  userId: string,
  inDeal: MT5Deal,
  outDeal: MT5Deal,
  user: User,
): Trade | null {
  const indexSymbol: IndexSymbol | undefined = MT5_TO_INDEX[inDeal.symbol]
  if (!indexSymbol) return null  // Unknown symbol (forex, crypto, etc.) → skip

  const entryTime = safeParseTime(inDeal.time)
  const exitTime  = safeParseTime(outDeal.time)
  const profit    = outDeal.profit ?? 0

  // In MT5: DEAL_TYPE_BUY = long position, DEAL_TYPE_SELL = short position
  const direction: 'BUY' | 'SELL' = inDeal.type === 'DEAL_TYPE_BUY' ? 'BUY' : 'SELL'

  console.log('[mt5sync] building trade:', {
    positionId: inDeal.positionId,
    symbol: inDeal.symbol,
    indexSymbol,
    inTime: inDeal.time,
    outTime: outDeal.time,
    inPrice: inDeal.price,
    outPrice: outDeal.price,
    inVolume: inDeal.volume,
    outProfit: outDeal.profit,
    entryTime,
    exitTime,
  })

  return {
    tradeId:          inDeal.positionId,
    userId,
    fecha:            new Date(entryTime - 6 * 60 * 60 * 1000).toISOString().split('T')[0], // UTC-6 (Costa Rica)
    horaEntrada:      new Date(entryTime).toISOString(),
    horaCierre:       new Date(exitTime).toISOString(),
    duracionMinutos:  Math.round((exitTime - entryTime) / 60_000),
    cuenta:           user.mt5AccountType ?? 'demo',
    indice:           indexSymbol,
    direccion:        direction,
    precioEntrada:    inDeal.price ?? 0,
    precioCierre:     outDeal.price ?? 0,
    stake:            inDeal.volume ?? 0,
    gananciaUSD:      profit,
    resultado:        profit > 0 ? 'WIN' : 'LOSS',
    // Stochastic — neutral defaults (no live candle analysis for MT5 historical trades)
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

// ─── Core sync logic for one user ────────────────────────────────────────────

async function syncUserMT5(
  user: User & { PK: string },
  windowMs: number = 72 * 60 * 60 * 1000,
): Promise<{ synced: number; errors: number; total: number; skipped: number }> {
  const accountId = user.metaApiAccountId!

  // Load existing trade IDs to avoid duplicates (positionId used as tradeId)
  const existing = await queryItems<{ SK: string }>({
    TableName: TABLES.TRADES,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': user.PK, ':prefix': 'TRADE#' },
    ProjectionExpression: 'SK',
  })
  const existingIds = new Set(existing.map((e) => e.SK.split('#')[1]))

  // Deploy account, wait for connection, pull deals, then undeploy
  await deployAccount(accountId)
  try {
    await waitConnected(accountId, 60_000)

    const endTime   = new Date().toISOString()
    const startTime = new Date(Date.now() - windowMs).toISOString()
    const deals = await getDeals(accountId, startTime, endTime) as MT5Deal[]
    console.log('[mt5sync] raw deals count:', deals.length)
    if (deals.length > 0) {
      console.log('[mt5sync] sample deal[0]:', JSON.stringify(deals[0]))
    }

    // Group deals by positionId: collect IN and OUT pairs
    const byPosition = new Map<string, { in?: MT5Deal; out?: MT5Deal }>()
    for (const d of deals) {
      if (!byPosition.has(d.positionId)) byPosition.set(d.positionId, {})
      const entry = byPosition.get(d.positionId)!
      if (d.entryType === 'DEAL_ENTRY_IN')  entry.in  = d
      if (d.entryType === 'DEAL_ENTRY_OUT') entry.out = d
    }

    let synced = 0
    let errors = 0
    let skipped = 0
    let total = 0

    for (const [posId, pair] of byPosition) {
      if (!pair.in || !pair.out) continue          // Incomplete pair → skip
      total++
      if (existingIds.has(posId)) { skipped++; continue }  // Already saved → skip

      try {
        const trade = buildMT5Trade(user.PK, pair.in, pair.out, user)
        if (!trade) { skipped++; continue }

        // ── Stochastic calculation (best-effort via MetaAPI candles) ────────
        try {
          const entryMs = new Date(trade.horaEntrada).getTime()
          const startMs = entryMs - 40 * 5 * 60 * 1000
          const rawCandles = await getCandles(accountId, pair.in.symbol, 5, 80, startMs)

          if (rawCandles.length >= 5) {
            const candles: Candle[] = rawCandles.map(c => ({
              time: Math.floor(new Date(c.time).getTime() / 1000),
              open: c.open,
              high: c.high,
              low: c.low,
              close: c.close,
            }))

            const stoch = calculateStochastic(candles)
            const kLast = stoch.k[stoch.k.length - 1] ?? 50
            const dLast = stoch.d[stoch.d.length - 1] ?? 50
            trade.stochK_entrada = kLast
            trade.stochD_entrada = dLast
            trade.stochZona      = getStochZone(kLast)
            trade.stochCruce     = detectCross(stoch.k, stoch.d)
            console.log(`[mt5sync] stoch calculated for ${posId}: K=${kLast.toFixed(1)} D=${dLast.toFixed(1)}`)
          } else {
            console.warn(`[mt5sync] not enough candles (${rawCandles.length}) for ${posId}, using neutral defaults`)
          }
        } catch (stochErr) {
          // Stochastic failure must NOT abort the trade save
          console.warn(`[mt5sync] stoch calculation failed for ${posId}:`, String(stochErr))
        }
        // ── End stochastic ───────────────────────────────────────────────────

        const sk = `TRADE#${trade.tradeId}#${trade.horaEntrada}`
        await putItem(TABLES.TRADES, { PK: user.PK, SK: sk, ...trade })
        synced++
      } catch (e) {
        console.error(`[mt5sync] Error saving position ${posId}:`, e)
        errors++
      }
    }

    return { synced, errors, total, skipped }
  } finally {
    // Always undeploy to minimize cost ($0.0126/hr)
    try { await undeployAccount(accountId) } catch { /* ignore */ }
  }
}

// ─── Async self-invoke helper ─────────────────────────────────────────────────

async function dispatchAsync(functionName: string, userId: string, windowMs: number): Promise<void> {
  await lambdaClient.send(new InvokeCommand({
    FunctionName: functionName,
    InvocationType: 'Event',   // fire-and-forget — bypasses API GW 30s timeout
    Payload: Buffer.from(JSON.stringify({ source: 'worker', userId, windowMs })),
  }))
}

async function runSyncForUser(userId: string, windowMs: number): Promise<void> {
  const user = await getItem<User & { PK: string; SK: string }>(
    TABLES.USERS, { PK: userId, SK: 'PROFILE' },
  )
  if (!user?.metaApiAccountId) { console.error('[mt5sync] worker: no metaApiAccountId for', userId); return }
  const { synced, errors, total, skipped } = await syncUserMT5(user, windowMs)
  await updateItem(TABLES.USERS, { PK: userId, SK: 'PROFILE' }, { mt5LastSync: new Date().toISOString() })
  console.log(`[mt5sync] worker done user=${userId} synced=${synced} skipped=${skipped} errors=${errors} total=${total}`)
}

// ─── HTTP handler — POST /trades/mt5-sync-now (manual trigger from Settings) ─
// API GW HTTP API has a hard 30s timeout; the actual sync can take up to 90s.
// Solution: validate quickly, fire the real sync async (self-invoke), return 200 immediately.

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer | WorkerPayload) => {
  // ── Worker mode: invoked asynchronously by self ──
  if ('source' in event && (event as WorkerPayload).source === 'worker') {
    const { userId, windowMs } = event as WorkerPayload
    await runSyncForUser(userId, windowMs)
    return
  }

  // ── HTTP mode: validate + dispatch async ──
  try {
    const userId = getUserId(event as APIGatewayProxyEventV2WithJWTAuthorizer)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (!user?.metaApiAccountId) return err('Cuenta MT5 no conectada', 400)

    await dispatchAsync(process.env.AWS_LAMBDA_FUNCTION_NAME!, userId, 72 * 60 * 60 * 1000)
    console.log(`[mt5sync] dispatched 72h sync for user=${userId}`)
    return ok({ queued: true, synced: 0, errors: 0, total: 0, skipped: 0 })
  } catch (e) {
    console.error('[mt5sync] handler error:', e)
    return err('Error al iniciar sincronización', 500)
  }
}

// ─── HTTP handler — POST /trades/mt5-sync-history (import last 30 days) ──────

export const historySync = async (event: APIGatewayProxyEventV2WithJWTAuthorizer | WorkerPayload) => {
  // ── Worker mode ──
  if ('source' in event && (event as WorkerPayload).source === 'worker') {
    const { userId, windowMs } = event as WorkerPayload
    await runSyncForUser(userId, windowMs)
    return
  }

  // ── HTTP mode ──
  try {
    const userId = getUserId(event as APIGatewayProxyEventV2WithJWTAuthorizer)
    if (!userId) return err('No autorizado', 401)

    const user = await getItem<User & { PK: string; SK: string }>(
      TABLES.USERS, { PK: userId, SK: 'PROFILE' },
    )
    if (!user?.metaApiAccountId) return err('Cuenta MT5 no conectada', 400)

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
    await dispatchAsync(process.env.AWS_LAMBDA_FUNCTION_NAME!, userId, THIRTY_DAYS_MS)
    console.log(`[mt5sync] dispatched 30d history sync for user=${userId}`)
    return ok({ queued: true, synced: 0, errors: 0, total: 0, skipped: 0 })
  } catch (e) {
    console.error('[mt5sync] historySync error:', e)
    return err('Error al iniciar importación', 500)
  }
}

// ─── Scheduled handler — EventBridge daily cron (all Pro users) ──────────────

export const dailySync = async (_event: ScheduledEvent) => {
  console.log('[mt5sync] Starting daily sync...')

  // Scan all users with metaApiAccountId (Pro users with MT5 connected)
  const users = await scanItems<User & { PK: string; SK: string }>({
    TableName: TABLES.USERS,
    FilterExpression: 'attribute_exists(metaApiAccountId) AND SK = :sk',
    ExpressionAttributeValues: { ':sk': 'PROFILE' },
  })

  console.log(`[mt5sync] Found ${users.length} users with MT5 connected`)

  let totalSynced = 0
  let totalErrors = 0

  for (const user of users) {
    try {
      const { synced, errors } = await syncUserMT5(user)
      await updateItem(TABLES.USERS, { PK: user.PK, SK: 'PROFILE' }, {
        mt5LastSync: new Date().toISOString(),
      })
      totalSynced += synced
      totalErrors += errors
      console.log(`[mt5sync] user=${user.PK} synced=${synced} errors=${errors}`)
    } catch (e) {
      console.error(`[mt5sync] Failed for user ${user.PK}:`, e)
      totalErrors++
    }
  }

  console.log(`[mt5sync] Daily sync complete: synced=${totalSynced} errors=${totalErrors}`)
}
