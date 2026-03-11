import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Filter, BarChart2, TrendingUp, TrendingDown, RefreshCw, History } from 'lucide-react'
import { useTrades, useTrade, useTradeCandles, useSyncTrades, useSyncHistory } from '../hooks/useTrades'
import { TradeCard } from '../components/TradeCard'
import { TradeChart } from '../components/TradeChart'
import { formatDateTime } from '../lib/dateUtils'
import { ALL_INDICES, INDEX_LABELS } from '../shared/types'
import type { IndexSymbol, Candle } from '../shared/types'

const INDICES: IndexSymbol[] = ALL_INDICES

// ─── Trade Detail ─────────────────────────────────────────────────────────────
export function TradeDetail() {
  const { tradeId } = useParams<{ tradeId: string }>()
  const navigate = useNavigate()
  const { data: trade, isLoading } = useTrade(tradeId ?? '')
  const { data: chartData, isLoading: chartLoading } = useTradeCandles(tradeId ?? '')

  if (isLoading) return <PageSkeleton />
  if (!trade) return <div className="p-6 text-gray-500">Trade no encontrado.</div>

  const isWin = trade.resultado === 'WIN'
  const pnl = trade.gananciaUSD ?? 0

  // Only show stoch data if it was actually calculated (not the default 50/50)
  const hasStochData = (trade.stochK_entrada != null && trade.stochK_entrada !== 50)
    || (trade.stochD_entrada != null && trade.stochD_entrada !== 50)
    || trade.stochCruce === true

  const trendColor =
    trade.tendencia === 'ALCISTA' ? 'text-green-600' :
    trade.tendencia === 'BAJISTA' ? 'text-red-600' :
    'text-gray-400'

  return (
    <div className="pb-16">
      {/* Sticky back nav */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#eeeeee] px-5 py-4 flex items-center gap-3">
        <button
          onClick={() => navigate(-1)}
          className="p-1 text-[#6c6d84] hover:text-[#1a1a2e] transition-colors"
        >
          <ArrowLeft size={20} />
        </button>
        <div className="flex items-center gap-2">
          {trade.direccion === 'BUY'
            ? <TrendingUp size={14} className="text-green-600" />
            : <TrendingDown size={14} className="text-red-600" />
          }
          <span className="text-sm font-semibold text-gray-900">
            {INDEX_LABELS[trade.indice] ?? trade.indice}
          </span>
          <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-md font-mono ${
            trade.direccion === 'BUY'
              ? 'text-green-600 bg-green-50'
              : 'text-red-600 bg-red-50'
          }`}>
            {trade.direccion}
          </span>
        </div>
      </div>

      <div className="max-w-xl mx-auto px-5 pt-5 space-y-4">

        {/* ── Hero card ── */}
        <div className={`rounded-2xl p-5 border bg-gradient-to-br ${
          isWin
            ? 'from-green-50 to-white border-green-200'
            : 'from-red-50 to-white border-red-200'
        }`}>
          <div className="flex items-start justify-between mb-5">
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Ganancia / Pérdida</p>
              <p className={`text-4xl font-bold tracking-tight ${isWin ? 'text-green-600' : 'text-red-600'}`}>
                {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
              </p>
              <p className="text-xs text-gray-400 font-mono mt-2">
                {formatDateTime(trade.horaEntrada)}
              </p>
            </div>
            <span className={`text-xs font-bold px-3 py-1.5 rounded-full border tracking-wide ${
              isWin
                ? 'text-green-600 border-green-200 bg-green-50'
                : 'text-red-600 border-red-200 bg-red-50'
            }`}>
              {trade.resultado}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 pt-4 border-t border-gray-100">
            {[
              { label: 'Entrada', value: (trade.precioEntrada ?? 0).toFixed(5) },
              { label: 'Cierre',  value: (trade.precioCierre ?? 0).toFixed(5) },
              { label: 'Stake',   value: (trade.stake ?? 0).toFixed(2) },
              { label: 'Duración', value: `${trade.duracionMinutos ?? 0}m` },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-[9px] font-semibold tracking-widest uppercase text-gray-400 mb-1">
                  {label}
                </p>
                <p className="text-xs font-mono text-gray-700">{value}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Chart ── */}
        <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
          <div className="px-4 pt-4 pb-2 flex items-center gap-2">
            <BarChart2 size={12} className="text-gray-400" />
            <span className="text-xs font-semibold tracking-widest uppercase text-gray-400">
              Velas 5M
            </span>
          </div>
          {chartLoading ? (
            <div className="h-[260px] flex items-center justify-center">
              <BarChart2 size={22} className="text-gray-400 animate-pulse" />
            </div>
          ) : chartData && chartData.candles.length > 0 ? (
            <TradeChart
              candles={chartData.candles as Candle[]}
              entryTime={chartData.entryEpoch}
              exitTime={chartData.exitEpoch}
              entryPrice={chartData.entryPrice}
              exitPrice={chartData.exitPrice}
              height={260}
            />
          ) : (
            <div className="h-[260px] flex flex-col items-center justify-center gap-2">
              <BarChart2 size={26} className="text-gray-400 opacity-30" />
              <p className="text-xs text-gray-400">Sin datos históricos en Deriv</p>
            </div>
          )}
        </div>

        {/* ── Detalles de la cuenta ── */}
        <Section title="Cuenta">
          <Row label="Tipo de cuenta" value={(trade.cuenta ?? '—').toUpperCase()} />
        </Section>

        {/* ── Análisis de señal ── */}
        <Section title="Señal y Tendencia">
          <Row
            label="Señal detectada"
            value={trade.senalValida ? 'Sí ✓' : 'No'}
            valueClass={trade.senalValida ? 'text-green-600' : 'text-gray-400'}
          />
          {trade.tendencia && (
            <Row
              label="Tendencia (EMA 20/50)"
              value={trade.tendencia}
              valueClass={trendColor}
            />
          )}
          {hasStochData && (
            <>
              <Row label="Zona estocástico" value={trade.stochZona ?? '—'} />
              <Row
                label="Cruce K/D"
                value={trade.stochCruce ? 'Sí ✓' : 'No'}
                valueClass={trade.stochCruce ? 'text-green-600' : 'text-gray-400'}
              />
            </>
          )}
          {/* Confluences */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-500">Confluencias</span>
            <div className="flex gap-2">
              {[
                { label: '1H',  ok: trade.confluencia1H },
                { label: '15M', ok: trade.confluencia15M },
                { label: '5M',  ok: trade.confluencia5M },
              ].map(({ label, ok }) => (
                <span
                  key={label}
                  className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-lg border ${
                    ok
                      ? 'bg-green-50 text-green-600 border-green-200'
                      : 'bg-gray-50 text-gray-400 border-gray-200'
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}

// ─── Reusable components ───────────────────────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#eeeeee] bg-white overflow-hidden">
      <div className="px-4 pt-4 pb-2">
        <span className="text-xs font-semibold tracking-widest uppercase text-[#6c6d84]">
          {title}
        </span>
      </div>
      {children}
    </div>
  )
}

function Row({
  label,
  value,
  valueClass = 'text-[#1a1a2e]',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-[#eeeeee]">
      <span className="text-sm text-[#6c6d84]">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value}</span>
    </div>
  )
}

const AUTO_SYNC_KEY = 'syntra_last_auto_sync'
const ONE_DAY_MS    = 24 * 60 * 60 * 1000

// ─── Journal List ─────────────────────────────────────────────────────────────
export function Journal() {
  const [filters, setFilters] = useState<{
    indice?: string
    resultado?: string
    fecha?: string
    page: number
  }>({ page: 1 })
  const [showFilters, setShowFilters]   = useState(false)
  const [autoSyncing, setAutoSyncing]   = useState(false)
  const { data, isLoading, refetch }    = useTrades(filters)
  const sync    = useSyncTrades()
  const history = useSyncHistory()
  const didAutoSync = useRef(false)

  // ── Auto-sync once per day on mount ───────────────────────────────────────
  useEffect(() => {
    if (didAutoSync.current) return
    didAutoSync.current = true

    const last = localStorage.getItem(AUTO_SYNC_KEY)
    const now  = Date.now()

    if (!last || now - parseInt(last) > ONE_DAY_MS) {
      setAutoSyncing(true)
      localStorage.setItem(AUTO_SYNC_KEY, now.toString())
      sync.mutate(undefined, {
        onSettled: () => {
          setAutoSyncing(false)
          setTimeout(() => { void refetch() }, 3000)
        },
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Manual handlers ────────────────────────────────────────────────────────
  const handleSync = async () => {
    localStorage.setItem(AUTO_SYNC_KEY, Date.now().toString())
    await sync.mutateAsync()
    setTimeout(() => { void refetch() }, 3000)
  }
  const handleHistory = async () => {
    await history.mutateAsync()
    setTimeout(() => { void refetch() }, 5000)
  }

  const isSyncing = sync.isPending || autoSyncing

  const syncMsg = autoSyncing
    ? 'Actualizando trades…'
    : sync.data
      ? sync.data.queued
        ? 'Trades llegando en ~1 min…'
        : `${sync.data.synced} trade(s) sincronizados`
      : history.data
        ? history.data.queued
          ? 'Historial llegando en ~1 min…'
          : `${history.data.synced} nuevos de ${history.data.total}`
        : null

  return (
    <div className="pb-4">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#eeeeee] px-5 py-4">
        {/* Top row: title + filter */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-base font-bold text-[#1a1a2e]">Bitácora</h1>
            <p className="text-xs text-[#6c6d84]">{data?.total ?? 0} trades</p>
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`flex items-center gap-2 h-9 px-4 rounded-full text-xs font-semibold transition-all ${
              showFilters
                ? 'bg-[#ff8a71] text-white'
                : 'bg-[#f5fafb] border border-[#eeeeee] text-[#6c6d84] hover:border-[#ff8a71] hover:text-[#ff8a71]'
            }`}
          >
            <Filter size={12} />
            Filtrar
          </button>
        </div>

        {/* Sync row */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void handleSync() }}
            disabled={isSyncing || history.isPending}
            className="flex items-center gap-1.5 h-8 px-3 bg-[#f5fafb] border border-[#eeeeee] hover:border-[#ff8a71] rounded-xl text-xs font-semibold text-[#1a1a2e] transition-all disabled:opacity-50"
          >
            <RefreshCw size={12} className={isSyncing ? 'animate-spin text-[#ff8a71]' : 'text-[#ff8a71]'} />
            {isSyncing ? 'Sincronizando…' : 'Sync 72h'}
          </button>
          <button
            onClick={() => { void handleHistory() }}
            disabled={isSyncing || history.isPending}
            className="flex items-center gap-1.5 h-8 px-3 bg-[#f5fafb] border border-[#eeeeee] hover:border-[#ff8a71] rounded-xl text-xs font-semibold text-[#1a1a2e] transition-all disabled:opacity-50"
          >
            <History size={12} className={history.isPending ? 'animate-pulse text-[#6c6d84]' : 'text-[#6c6d84]'} />
            {history.isPending ? 'Importando…' : 'Historial 30d'}
          </button>
          {syncMsg && (
            <span className={`text-[11px] font-medium truncate ${autoSyncing ? 'text-[#6c6d84]' : 'text-green-600'}`}>
              {syncMsg}
            </span>
          )}
        </div>
      </div>

      <div className="px-5 pt-5">
        {/* Filters panel */}
        {showFilters && (
          <div className="bg-white border border-[#eeeeee] rounded-2xl p-4 mb-4 grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#6c6d84] mb-1.5">
                Índice
              </label>
              <select
                value={filters.indice ?? ''}
                onChange={(e) => setFilters({ ...filters, indice: e.target.value || undefined, page: 1 })}
                className="w-full bg-[#f5fafb] border border-[#eeeeee] text-[#1a1a2e] text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:border-[#ff8a71]"
              >
                <option value="">Todos</option>
                {INDICES.map(i => <option key={i} value={i}>{INDEX_LABELS[i]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#6c6d84] mb-1.5">
                Resultado
              </label>
              <select
                value={filters.resultado ?? ''}
                onChange={(e) => setFilters({ ...filters, resultado: e.target.value || undefined, page: 1 })}
                className="w-full bg-[#f5fafb] border border-[#eeeeee] text-[#1a1a2e] text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:border-[#ff8a71]"
              >
                <option value="">Todos</option>
                <option value="WIN">WIN</option>
                <option value="LOSS">LOSS</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-widest text-[#6c6d84] mb-1.5">
                Fecha
              </label>
              <input
                type="date"
                value={filters.fecha ?? ''}
                onChange={(e) => setFilters({ ...filters, fecha: e.target.value || undefined, page: 1 })}
                className="w-full bg-[#f5fafb] border border-[#eeeeee] text-[#1a1a2e] text-xs rounded-xl px-2 py-1.5 focus:outline-none focus:border-[#ff8a71]"
              />
            </div>
          </div>
        )}

        {/* Trade list */}
        {isLoading ? (
          <ListSkeleton />
        ) : data?.trades.length === 0 ? (
          <div className="text-center py-16 text-[#6c6d84]">
            <p className="text-sm">Sin trades que coincidan.</p>
          </div>
        ) : (
          <>
            <div className="bg-white rounded-2xl border border-[#eeeeee] overflow-hidden divide-y divide-[#eeeeee]">
              {data?.trades.map(t => <TradeCard key={t.tradeId} trade={t} />)}
            </div>

            {/* Pagination */}
            {data && data.total > 20 && (
              <div className="flex items-center justify-center gap-3 mt-4">
                <button
                  disabled={filters.page <= 1}
                  onClick={() => setFilters({ ...filters, page: filters.page - 1 })}
                  className="h-9 px-5 text-sm font-semibold bg-white border border-[#eeeeee] text-[#1a1a2e] rounded-full disabled:opacity-40 hover:border-[#ff8a71] transition-colors"
                >
                  ← Anterior
                </button>
                <span className="text-xs text-[#6c6d84] font-mono">{filters.page}</span>
                <button
                  disabled={!data.hasMore}
                  onClick={() => setFilters({ ...filters, page: filters.page + 1 })}
                  className="h-9 px-5 text-sm font-semibold bg-[#ff8a71] text-white rounded-full disabled:opacity-40 hover:bg-[#ff9d8a] transition-colors"
                >
                  Siguiente →
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ─── Skeleton loaders ─────────────────────────────────────────────────────────
function PageSkeleton() {
  return (
    <div className="max-w-xl mx-auto px-4 pt-5 space-y-3 animate-pulse">
      <div className="h-40 bg-gray-100 rounded-2xl border border-gray-100" />
      <div className="h-72 bg-gray-100 rounded-2xl border border-gray-100" />
      <div className="h-24 bg-gray-100 rounded-2xl border border-gray-100" />
      <div className="h-36 bg-gray-100 rounded-2xl border border-gray-100" />
    </div>
  )
}

function ListSkeleton() {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden divide-y divide-gray-100 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-[66px] bg-gray-50" />
      ))}
    </div>
  )
}
