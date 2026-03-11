/**
 * Test: MetaApi → pull MT5 deal history
 * Usage: node test-metaapi.mjs
 */

const ACCOUNT_ID = 'fe9781a2-5971-4b24-ae01-db4956e42de6'
const TOKEN      = process.argv[2] // pass token as arg to avoid hardcoding

if (!TOKEN) { console.error('Usage: node test-metaapi.mjs <TOKEN>'); process.exit(1) }

const BASE_PROVISIONING = 'https://mt-provisioning-api-v1.agiliumtrade.agiliumtrade.ai'
const BASE_CLIENT       = 'https://mt-client-api-v1.london.agiliumtrade.ai'
const HEADERS = { 'auth-token': TOKEN, 'Content-Type': 'application/json' }

async function get(base, path) {
  const res = await fetch(`${base}${path}`, { headers: HEADERS })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`HTTP ${res.status}: ${body}`)
  }
  return res.json()
}

// ── Symbol mapping (same as SYNTRA) ──────────────────────────────────────────
// MT5 (MetaApi) uses human-readable names, not technical symbols
const MT5_TO_INDEX = {
  'Crash 300 Index':  'CRASH_300',
  'Crash 500 Index':  'CRASH_500',
  'Crash 600 Index':  'CRASH_600',
  'Crash 900 Index':  'CRASH_900',
  'Crash 1000 Index': 'CRASH_1000',
  'Boom 300 Index':   'BOOM_300',
  'Boom 500 Index':   'BOOM_500',
  'Boom 600 Index':   'BOOM_600',
  'Boom 900 Index':   'BOOM_900',
  'Boom 1000 Index':  'BOOM_1000',
}
const DERIV_TO_INDEX = MT5_TO_INDEX // alias for compatibility

async function main() {
  console.log(`\n${'─'.repeat(60)}`)
  console.log('  SYNTRA — Test MetaApi MT5 deal history')
  console.log(`${'─'.repeat(60)}\n`)

  // 1. Account info
  console.log('① Verificando cuenta...')
  const account = await get(BASE_PROVISIONING, `/users/current/accounts/${ACCOUNT_ID}`)
  console.log(`   Nombre:    ${account.name}`)
  console.log(`   Broker:    ${account.broker ?? account.server ?? '—'}`)
  console.log(`   Estado:    ${account.connectionStatus ?? account.state ?? '—'}`)
  console.log(`   Región:    ${account.region ?? account.magic ?? '—'}`)

  // 2. Deal history — last 30 days
  console.log('\n② Bajando deals (últimos 30 días)...')
  const startTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
  const endTime   = new Date().toISOString()

  let deals = []
  try {
    deals = await get(
      BASE_CLIENT,
      `/users/current/accounts/${ACCOUNT_ID}/history-deals/time` +
      `/${encodeURIComponent(startTime)}/${encodeURIComponent(endTime)}`
    )
  } catch (e) {
    console.log(`   Error 30d: ${e.message}`)
  }

  console.log(`   Total deals (30d): ${deals.length}`)

  if (deals.length === 0) {
    console.log('\n   Sin deals en 30 días — intentando historial completo...')
    try {
      const all = await get(
        BASE_CLIENT,
        `/users/current/accounts/${ACCOUNT_ID}/history-deals/time` +
        `/${encodeURIComponent('2020-01-01T00:00:00.000Z')}` +
        `/${encodeURIComponent(endTime)}`
      )
      console.log(`   Total histórico completo: ${all.length} deals`)
      deals = all
    } catch (e) {
      console.log(`   Error histórico completo: ${e.message}`)
    }
  }

  if (deals.length === 0) {
    console.log('\n  Sin deals encontrados.')
    return
  }

  // 3. Análisis
  console.log(`\n${'─'.repeat(60)}`)
  console.log('③ Análisis de deals:')

  const symbolCount = {}
  let wins = 0, losses = 0, totalProfit = 0

  for (const d of deals) {
    const sym = d.symbol ?? '(none)'
    symbolCount[sym] = (symbolCount[sym] ?? 0) + 1
    if (d.profit !== undefined) {
      totalProfit += d.profit
      if (d.profit > 0) wins++
      else if (d.profit < 0) losses++
    }
  }

  console.log('\n  Símbolos:')
  for (const [sym, count] of Object.entries(symbolCount).sort((a,b) => b[1]-a[1])) {
    const mapped = DERIV_TO_INDEX[sym]
    const tag = mapped ? `→ ${mapped} ✅` : '⚠️  sin mapeo'
    console.log(`    ${sym.padEnd(14)} ${String(count).padStart(4)} deals  ${tag}`)
  }

  console.log(`\n  Wins:    ${wins}`)
  console.log(`  Losses:  ${losses}`)
  console.log(`  P&L:     $${totalProfit.toFixed(2)}`)

  // 4. Todos los campos del primer deal
  const sample = deals[0]
  console.log('\n④ Todos los campos del primer deal:')
  for (const [k, v] of Object.entries(sample)) {
    console.log(`   ${k.padEnd(20)} ${String(v).slice(0, 50)}`)
  }

  // 5. Viability for SYNTRA mapping
  console.log(`\n${'─'.repeat(60)}`)
  const mappable = deals.filter(d => MT5_TO_INDEX[d.symbol])
  console.log(`\n  Resultado: ${mappable.length > 0 ? '✅ MetaApi funciona para SYNTRA' : '⚠️  Revisar mapeo de símbolos'}`)
  console.log(`${'─'.repeat(60)}\n`)
}

main().catch(e => { console.error('\n[ERROR]', e.message); process.exit(1) })
