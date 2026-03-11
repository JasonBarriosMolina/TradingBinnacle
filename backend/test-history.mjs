/**
 * Test script for the 30-day history sync feature.
 * Usage: node test-history.mjs <DERIV_TOKEN>
 *
 * What this tests:
 *  1. WebSocket auth + profit_table request with description:1
 *  2. Whether underlying_symbol is returned per trade
 *  3. Pagination (offset-based, 500/page)
 *  4. Coverage of 30-day range
 *  5. Symbol mapping against DERIV_TO_INDEX
 */

import WebSocket from 'ws'

const TOKEN     = process.argv[2]
const APP_ID    = '129387'
const WS_URL    = `wss://ws.binaryws.com/websockets/v3?app_id=${APP_ID}`
const PAGE_SIZE = 500

const DERIV_TO_INDEX = {
  'CRASH300N':  'CRASH_300', 'CRASH500N':  'CRASH_500',
  'CRASH600N':  'CRASH_600', 'CRASH900N':  'CRASH_900',
  'CRASH1000N': 'CRASH_1000',
  'BOOM300N':   'BOOM_300',  'BOOM500N':   'BOOM_500',
  'BOOM600N':   'BOOM_600',  'BOOM900N':   'BOOM_900',
  'BOOM1000N':  'BOOM_1000',
  'CRASH300':  'CRASH_300',  'CRASH500':  'CRASH_500',
  'CRASH600':  'CRASH_600',  'CRASH900':  'CRASH_900',
  'CRASH1000': 'CRASH_1000',
  'BOOM300':   'BOOM_300',   'BOOM500':   'BOOM_500',
  'BOOM600':   'BOOM_600',   'BOOM900':   'BOOM_900',
  'BOOM1000':  'BOOM_1000',
}

if (!TOKEN) {
  console.error('Usage: node test-history.mjs <DERIV_TOKEN>')
  process.exit(1)
}

function wsRequest(payload) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL)
    let authorized = false

    ws.on('open', () => ws.send(JSON.stringify({ authorize: TOKEN })))

    ws.on('message', (raw) => {
      const data = JSON.parse(raw.toString())
      if (data.error) { ws.close(); return reject(new Error(data.error.message)) }
      if (data.authorize && !authorized) {
        authorized = true
        ws.send(JSON.stringify(payload))
        return
      }
      const key = Object.keys(payload)[0]
      if (data[key] !== undefined) { ws.close(); resolve(data) }
    })

    ws.on('error', reject)
    setTimeout(() => { ws.close(); reject(new Error('WS timeout')) }, 30000)
  })
}

async function getProfitPage(limit, offset, dateFrom) {
  const payload = { profit_table: 1, description: 1, limit, sort: 'DESC', offset, date_from: dateFrom }
  const res = await wsRequest(payload)
  return res.profit_table?.transactions ?? []
}

async function main() {
  const dateFrom = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60
  const dateFromStr = new Date(dateFrom * 1000).toISOString().split('T')[0]

  console.log(`\n${'─'.repeat(55)}`)
  console.log(`  SYNTRA — Test historySync (30 días)`)
  console.log(`  Desde: ${dateFromStr}`)
  console.log(`  App ID: ${APP_ID}`)
  console.log(`${'─'.repeat(55)}\n`)

  const allTrades = []
  let offset = 0
  let page = 1

  while (true) {
    process.stdout.write(`  Página ${page} (offset ${offset})... `)
    const trades = await getProfitPage(PAGE_SIZE, offset, dateFrom)
    console.log(`${trades.length} trades`)
    allTrades.push(...trades)
    if (trades.length < PAGE_SIZE) break
    offset += PAGE_SIZE
    page++
    if (allTrades.length >= 5000) { console.log('  [cap 5000 alcanzado]'); break }
  }

  // ── Analysis ─────────────────────────────────────────────
  console.log(`\n${'─'.repeat(55)}`)
  console.log(`  Total trades obtenidos: ${allTrades.length}`)

  if (allTrades.length === 0) {
    console.log('\n  Sin trades en los últimos 30 días.')
    return
  }

  // Check underlying_symbol field
  const withSymbol    = allTrades.filter(t => t.underlying_symbol)
  const withoutSymbol = allTrades.filter(t => !t.underlying_symbol)
  console.log(`  Con underlying_symbol:    ${withSymbol.length}`)
  console.log(`  Sin underlying_symbol:    ${withoutSymbol.length}  ${withoutSymbol.length > 0 ? '⚠️' : '✅'}`)

  // Symbol breakdown
  const symbolCount = {}
  for (const t of allTrades) {
    const sym = t.underlying_symbol ?? '(none)'
    symbolCount[sym] = (symbolCount[sym] ?? 0) + 1
  }
  console.log('\n  Símbolos encontrados:')
  for (const [sym, count] of Object.entries(symbolCount).sort((a, b) => b[1] - a[1])) {
    const mapped = DERIV_TO_INDEX[sym]
    const tag = mapped ? `→ ${mapped}` : '⚠️  NO MAPEADO'
    console.log(`    ${sym.padEnd(14)} ${String(count).padStart(4)} trades   ${tag}`)
  }

  // Mapped vs skipped
  const mappable  = allTrades.filter(t => DERIV_TO_INDEX[t.underlying_symbol])
  const skippable = allTrades.filter(t => !DERIV_TO_INDEX[t.underlying_symbol])
  console.log(`\n  Se importarían: ${mappable.length} trades`)
  console.log(`  Se omitirían:   ${skippable.length} trades (forex, crypto, etc.)`)

  // Date range of actual data
  const times = allTrades.map(t => t.purchase_time).filter(Boolean)
  if (times.length) {
    const oldest = new Date(Math.min(...times) * 1000).toISOString().split('T')[0]
    const newest = new Date(Math.max(...times) * 1000).toISOString().split('T')[0]
    console.log(`\n  Rango real de datos: ${oldest} → ${newest}`)
  }

  // Sample first trade (field audit)
  console.log('\n  Campos del primer trade:')
  const sample = allTrades[0]
  const keys = ['contract_id','underlying_symbol','contract_type','buy_price','sell_price','purchase_time','sell_time','shortcode']
  for (const k of keys) {
    const v = sample[k]
    const present = v !== undefined && v !== null
    console.log(`    ${k.padEnd(22)} ${present ? String(v).slice(0,40) : '(ausente) ⚠️'}`)
  }

  // profit calculation check
  if (sample.buy_price != null && sample.sell_price != null) {
    const profit = (sample.sell_price - sample.buy_price).toFixed(2)
    const result = profit > 0 ? 'WIN ✅' : 'LOSS ✅'
    console.log(`\n  Profit calc (sell-buy): ${profit} USD → ${result}`)
  }

  console.log(`\n${'─'.repeat(55)}`)
  console.log('  Resultado: ' + (withoutSymbol.length === 0 && mappable.length > 0 ? '✅ Feature funciona correctamente' : '⚠️  Revisar campos marcados arriba'))
  console.log(`${'─'.repeat(55)}\n`)
}

main().catch(e => { console.error('\n[ERROR]', e.message); process.exit(1) })
