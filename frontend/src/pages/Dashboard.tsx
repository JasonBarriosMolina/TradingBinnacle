import { useQuery } from '@tanstack/react-query'
import { BookOpen, Wifi, WifiOff, TrendingUp, Zap, Bell } from 'lucide-react'
import { useTrades } from '../hooks/useTrades'
import { useMT5Auth } from '../hooks/useMT5Auth'
import { TradeCard } from '../components/TradeCard'
import { statsApi } from '../lib/api'
import { useAuthStore } from '../store/authStore'

function DashboardSkeleton() {
  return (
    <div className="animate-pulse">
      <div className="h-52 bg-[#040325]/80" />
      <div className="px-4 -mt-5 space-y-4">
        <div className="grid grid-cols-3 gap-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-[#eeeeee]" />
          ))}
        </div>
        <div className="h-32 bg-white rounded-2xl border border-[#eeeeee]" />
        <div className="bg-white rounded-2xl border border-[#eeeeee] overflow-hidden">
          {[...Array(4)].map((_, i) => <div key={i} className="h-16 border-b border-[#eeeeee] last:border-0" />)}
        </div>
      </div>
    </div>
  )
}

export function Dashboard() {
  const { user } = useAuthStore()
  const { data: tradesData, isLoading: tradesLoading } = useTrades({ page: 1 })
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => statsApi.get().then(r => r.data),
  })
  const mt5 = useMT5Auth()

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const todayTrades = (tradesData?.trades ?? []).filter(t => t.fecha === todayStr)
  const todayWins   = todayTrades.filter(t => t.resultado === 'WIN').length
  const todayWinrate = todayTrades.length > 0 ? (todayWins / todayTrades.length * 100).toFixed(0) : null
  const todayPnL    = todayTrades.reduce((acc, t) => acc + (t.gananciaUSD ?? 0), 0)
  const recentTrades = (tradesData?.trades ?? []).slice(0, 6)
  const isLoading   = tradesLoading || statsLoading

  return (
    <div>
      {isLoading ? <DashboardSkeleton /> : null}

      <div className={isLoading ? 'hidden' : ''}>

        {/* ── Hero section — deep navy bg ── */}
        <div className="bg-[#040325] px-6 pt-7 pb-12">
          {/* MT5 status */}
          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold mb-5 ${
            mt5.isConnected
              ? 'bg-[#ff8a71]/15 text-[#ff8a71]'
              : 'bg-red-500/15 text-red-400'
          }`}>
            {mt5.isConnected
              ? <><Wifi size={11} />{mt5.loginId} · {mt5.accountType}</>
              : <><WifiOff size={11} />MT5 no conectado</>
            }
          </div>

          {/* P&L label */}
          <p className="text-xs text-[#6c6d84] uppercase tracking-widest font-medium mb-1">P&amp;L hoy</p>

          {/* P&L amount */}
          <p className={`text-5xl font-bold font-mono leading-none mb-4 ${
            todayPnL > 0 ? 'text-[#ff8a71]' : todayPnL < 0 ? 'text-red-400' : 'text-white'
          }`}>
            {todayPnL >= 0 ? '+' : '−'}${Math.abs(todayPnL).toFixed(2)}
          </p>

          {/* Sub-stats */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="bg-white/8 text-[#9899b0] text-xs px-3 py-1 rounded-full">
              {todayTrades.length} trades
            </span>
            <span className="bg-white/8 text-[#9899b0] text-xs px-3 py-1 rounded-full">
              WR {todayWinrate ? `${todayWinrate}%` : '—'}
            </span>
            {stats && (
              <span className="bg-white/8 text-[#9899b0] text-xs px-3 py-1 rounded-full">
                {(stats.winrateGeneral * 100).toFixed(0)}% general
              </span>
            )}
          </div>
        </div>

        {/* ── Content lifted over hero ── */}
        <div className="px-5 -mt-5 space-y-4">

          {/* ── Quick actions ── */}
          <div className="grid grid-cols-3 gap-3">
            <QuickAction
              icon={<BookOpen size={18} />}
              label="Bitácora"
              color="#ff8a71"
              href="/journal"
            />
            <QuickAction
              icon={<Bell size={18} />}
              label="Señales"
              color="#7b8fd7"
              href="/signals"
            />
            <QuickAction
              icon={mt5.isConnected ? <Wifi size={18} /> : <WifiOff size={18} />}
              label={mt5.isConnected ? 'MT5 activo' : 'Conectar'}
              color={mt5.isConnected ? '#16A34A' : '#DC2626'}
              href="/settings"
            />
          </div>

          {/* ── Stat cards ── */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="P&L total"
              value={stats ? `${stats.pnlTotal >= 0 ? '+' : '−'}$${Math.abs(stats.pnlTotal).toFixed(2)}` : '—'}
              valueClass={stats && stats.pnlTotal >= 0 ? 'text-green-600' : 'text-red-500'}
              sub={`${stats?.totalTrades ?? 0} trades`}
            />
            <StatCard
              label="Winrate"
              value={stats ? `${(stats.winrateGeneral * 100).toFixed(0)}%` : '—'}
              sub={`${stats?.tradesConStoch ?? 0} con stoch`}
            />
          </div>

          {/* ── P&L Semanal ── */}
          {stats && stats.pnlPorSemana.length > 0 && (() => {
            const BAR_MAX_H = 52
            const max = Math.max(...stats.pnlPorSemana.map(x => Math.abs(x.pnl)), 0.01)
            return (
              <div className="bg-white rounded-2xl border border-[#eeeeee] px-5 py-4">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm font-semibold text-[#1a1a2e]">P&amp;L Semanal</p>
                  <p className="text-xs text-[#6c6d84]">Últimas 4 semanas</p>
                </div>
                <div className="flex items-end gap-2">
                  {stats.pnlPorSemana.map((w, i) => {
                    const barH = Math.max(Math.abs(w.pnl) / max * BAR_MAX_H, 3)
                    const isEmpty = w.pnl === 0
                    return (
                      <div key={i} className="flex-1 flex flex-col items-center gap-1.5">
                        {!isEmpty && (
                          <span className={`text-[9px] font-mono font-semibold ${w.pnl >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                            {w.pnl >= 0 ? '+' : ''}{w.pnl.toFixed(0)}
                          </span>
                        )}
                        {isEmpty && <span className="text-[9px] text-transparent select-none">0</span>}
                        <div
                          className={`w-full rounded-lg ${isEmpty ? 'bg-[#f0f0f5]' : w.pnl >= 0 ? 'bg-[#ff8a71]/70' : 'bg-red-400/70'}`}
                          style={{ height: `${barH}px` }}
                        />
                        <span className="text-[8px] text-[#6c6d84] font-mono text-center leading-tight whitespace-nowrap">
                          {w.week}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}

          {/* ── Últimas operaciones ── */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold text-[#1a1a2e]">Últimas operaciones</p>
              <a href="/journal" className="text-xs font-semibold text-[#ff8a71] hover:opacity-80 transition-opacity">
                Ver todas →
              </a>
            </div>
            {recentTrades.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#eeeeee] py-12 flex flex-col items-center gap-3">
                <div className="w-12 h-12 bg-[#f5fafb] rounded-2xl flex items-center justify-center">
                  <TrendingUp size={20} className="text-[#6c6d84]" />
                </div>
                <p className="text-sm text-[#6c6d84] text-center px-4">
                  Sin trades.{' '}
                  <a href="/settings" className="text-[#ff8a71] hover:opacity-80">Conecta MT5.</a>
                </p>
              </div>
            ) : (
              <div className="bg-white rounded-2xl border border-[#eeeeee] overflow-hidden divide-y divide-[#eeeeee]">
                {recentTrades.map(t => <TradeCard key={t.tradeId} trade={t} compact />)}
              </div>
            )}
          </div>

          {/* ── Free plan limit ── */}
          {user?.plan === 'free' && (tradesData?.total ?? 0) >= 25 && (
            <div className="px-4 py-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
              <Zap size={14} className="text-amber-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-amber-700">
                  {tradesData?.total}/30 trades usados
                </p>
                <p className="text-xs text-amber-600 mt-0.5">
                  Actualiza al plan Pro para registros ilimitados.
                </p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}

/* ── Reusable components ── */

function QuickAction({
  icon, label, color, onClick, disabled, href,
}: {
  icon: React.ReactNode
  label: string
  color: string
  onClick?: () => void
  disabled?: boolean
  href?: string
}) {
  const content = (
    <>
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center mb-2"
        style={{ backgroundColor: color + '18', color }}
      >
        {icon}
      </div>
      <span className="text-xs font-semibold text-[#1a1a2e] leading-tight text-center">{label}</span>
    </>
  )

  const cls = "flex flex-col items-center justify-center py-4 bg-white rounded-2xl border border-[#eeeeee] hover:border-[#d7d8e0] active:scale-[0.97] transition-all disabled:opacity-50"

  if (href) return <a href={href} className={cls}>{content}</a>
  return <button onClick={onClick} disabled={disabled} className={cls}>{content}</button>
}

function StatCard({
  label, value, valueClass = 'text-[#1a1a2e]', sub,
}: {
  label: string
  value: string
  valueClass?: string
  sub?: string
}) {
  return (
    <div className="bg-white border border-[#eeeeee] rounded-2xl px-4 py-4">
      <p className="text-xs font-semibold tracking-widest uppercase text-[#6c6d84] mb-2">{label}</p>
      <p className={`font-mono font-bold text-2xl leading-none ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-[#6c6d84] mt-2">{sub}</p>}
    </div>
  )
}
