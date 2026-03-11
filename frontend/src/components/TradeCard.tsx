import { Link } from 'react-router-dom'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { INDEX_LABELS } from '../shared/types'
import type { Trade } from '../shared/types'

interface TradeCardProps {
  trade: Trade
  compact?: boolean
}

export function TradeCard({ trade }: TradeCardProps) {
  const isWin = trade.resultado === 'WIN'
  const isBuy = trade.direccion === 'BUY'
  const pnl   = trade.gananciaUSD ?? 0

  return (
    <Link
      to={`/journal/${trade.tradeId}`}
      className="flex items-center gap-4 px-5 py-4 hover:bg-[#f5fafb] active:bg-[#eef0f5] transition-colors"
    >
      {/* Icon */}
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{
          backgroundColor: isBuy ? '#16A34A18' : '#DC262618',
          color: isBuy ? '#16A34A' : '#DC2626',
        }}
      >
        {isBuy ? <TrendingUp size={17} /> : <TrendingDown size={17} />}
      </div>

      {/* Middle */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-semibold text-[#1a1a2e] truncate">
            {INDEX_LABELS[trade.indice] ?? trade.indice}
          </span>
          <span
            className="text-xs font-bold font-mono px-1.5 py-0.5 rounded-md shrink-0"
            style={{
              color: isBuy ? '#16A34A' : '#DC2626',
              backgroundColor: isBuy ? '#16A34A18' : '#DC262618',
            }}
          >
            {trade.direccion}
          </span>
        </div>
        <p className="text-xs text-[#6c6d84] mt-0.5">
          {new Date(trade.horaEntrada).toLocaleDateString('es-CR', { day: 'numeric', month: 'short' })}
          {' · '}
          {new Date(trade.horaEntrada).toLocaleTimeString('es-CR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      </div>

      {/* P&L */}
      <div className="flex flex-col items-end gap-0.5 shrink-0">
        <span className={`text-sm font-bold font-mono ${isWin ? 'text-green-600' : 'text-red-500'}`}>
          {pnl >= 0 ? '+' : '−'}${Math.abs(pnl).toFixed(2)}
        </span>
        <span className={`text-xs font-semibold ${isWin ? 'text-green-500' : 'text-red-400'}`}>
          {trade.resultado}
        </span>
      </div>
    </Link>
  )
}
