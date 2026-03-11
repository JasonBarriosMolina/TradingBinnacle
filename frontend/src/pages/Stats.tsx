import { useQuery } from '@tanstack/react-query'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { statsApi } from '../lib/api'
import { INDEX_LABELS } from '../shared/types'
import type { IndexSymbol, Direction } from '../shared/types'

export function Stats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => statsApi.get().then((r) => r.data),
    staleTime: 300_000,
  })

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`

  return (
    <div className="pb-4">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#eeeeee] px-5 py-4">
        <h1 className="text-base font-bold text-[#1a1a2e]">Estadísticas</h1>
      </div>

      {isLoading || !stats ? (
        <div className="px-4 pt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-20 bg-[#f0f1f8] rounded-2xl animate-pulse" />
            ))}
          </div>
          <div className="grid gap-4">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-48 bg-[#f0f1f8] rounded-2xl animate-pulse" />
            ))}
          </div>
        </div>
      ) : (
        <div className="px-5 pt-5 space-y-4">

          {/* ── Overview cards ── */}
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Winrate"
              value={pct(stats.winrateGeneral)}
              valueClass={stats.winrateGeneral >= 0.5 ? 'text-green-600' : 'text-red-500'}
              sub="general"
            />
            <StatCard
              label="P&L total"
              value={`${stats.pnlTotal >= 0 ? '+' : ''}$${stats.pnlTotal.toFixed(2)}`}
              valueClass={stats.pnlTotal >= 0 ? 'text-green-600' : 'text-red-500'}
              sub={`${stats.totalTrades} trades`}
            />
            <StatCard
              label="Con señal"
              value={`${stats.tradesConStoch}`}
              sub={`de ${stats.totalTrades} trades`}
            />
            <StatCard
              label="Señal WR"
              value={pct(stats.winrateConSenal)}
              valueClass={stats.winrateConSenal >= 0.5 ? 'text-green-600' : 'text-red-500'}
              sub="con stoch"
            />
          </div>

          {/* ── Winrate por índice ── */}
          <div className="bg-white border border-[#eeeeee] rounded-2xl p-5">
            <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-4">
              Winrate por índice
            </p>
            <div className="flex flex-col gap-4">
              {(Object.entries(stats.winratePorIndice) as [IndexSymbol, number][]).map(([index, wr]) => (
                <div key={index}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-[#6c6d84] font-medium">{INDEX_LABELS[index]}</span>
                    <span className={`font-mono font-bold ${wr >= 0.5 ? 'text-green-600' : 'text-red-500'}`}>
                      {pct(wr)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-[#f0f1f8] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${wr >= 0.5 ? 'bg-[#ff8a71]' : 'bg-red-400'}`}
                      style={{ width: `${wr * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── Dirección ── */}
          <div className="bg-white border border-[#eeeeee] rounded-2xl p-5">
            <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-3">
              Rendimiento por dirección
            </p>
            <div className="flex flex-col divide-y divide-[#eeeeee]">
              {(Object.entries(stats.winratePorDireccion) as [Direction, number][]).map(([dir, wr]) => (
                <div key={dir} className="flex items-center justify-between py-3">
                  <span className="text-sm font-medium text-[#1a1a2e]">
                    {dir === 'BUY' ? '↑ BUY' : '↓ SELL'}
                  </span>
                  <span className={`font-mono text-sm font-bold ${wr >= 0.5 ? 'text-green-600' : 'text-red-500'}`}>
                    {pct(wr)}
                  </span>
                </div>
              ))}
              <div className="py-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6c6d84]">Con señal válida</span>
                  <span className={`font-mono text-sm font-bold ${stats.winrateConSenal >= 0.5 ? 'text-green-600' : 'text-[#6c6d84]'}`}>
                    {pct(stats.winrateConSenal)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#6c6d84]">Sin señal</span>
                  <span className="font-mono text-sm text-[#6c6d84]">{pct(stats.winrateSinSenal)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ── Mejor / Peor ── */}
          <div className="grid grid-cols-2 gap-3">
            {stats.mejorTrade && (
              <div className="bg-white border border-[#eeeeee] rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingUp size={12} className="text-green-600" />
                  <p className="text-xs font-bold tracking-widest uppercase text-green-600">Mejor</p>
                </div>
                <p className="text-xl font-mono font-bold text-green-600">
                  +${(stats.mejorTrade.gananciaUSD ?? 0).toFixed(2)}
                </p>
                <p className="text-xs text-[#6c6d84] mt-1.5">
                  {INDEX_LABELS[stats.mejorTrade.indice] ?? stats.mejorTrade.indice}
                </p>
              </div>
            )}
            {stats.peorTrade && (
              <div className="bg-white border border-[#eeeeee] rounded-2xl p-4">
                <div className="flex items-center gap-1.5 mb-3">
                  <TrendingDown size={12} className="text-red-500" />
                  <p className="text-xs font-bold tracking-widest uppercase text-red-500">Peor</p>
                </div>
                <p className="text-xl font-mono font-bold text-red-500">
                  ${(stats.peorTrade.gananciaUSD ?? 0).toFixed(2)}
                </p>
                <p className="text-xs text-[#6c6d84] mt-1.5">
                  {INDEX_LABELS[stats.peorTrade.indice] ?? stats.peorTrade.indice}
                </p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  )
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
      <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-2">{label}</p>
      <p className={`font-mono font-bold text-2xl leading-none ${valueClass}`}>{value}</p>
      {sub && <p className="text-xs text-[#6c6d84] mt-1.5">{sub}</p>}
    </div>
  )
}
