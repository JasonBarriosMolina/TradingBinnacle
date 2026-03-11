import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatDistanceToNow } from '../lib/dateUtils'
import { INDEX_LABELS } from '../shared/types'
import type { Signal } from '../shared/types'

interface SignalFeedProps {
  signals: Signal[]
}

export function SignalFeed({ signals }: SignalFeedProps) {
  if (signals.length === 0) {
    return (
      <div className="text-center py-16 text-gray-400">
        <p className="text-3xl mb-3 opacity-40">📡</p>
        <p className="text-sm">Sin señales recientes.</p>
        <p className="text-xs mt-1 text-gray-400">El monitor está activo.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {signals.map((signal, i) => {
        const isCrash = signal.tipo === 'CRASH'
        return (
          <div
            key={`${signal.timestamp}-${i}`}
            className={`bg-white border rounded-2xl shadow-sm p-4 ${
              isCrash ? 'border-red-200' : 'border-green-200'
            }`}
          >
            {/* Header row */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2.5">
                <div className={`p-1.5 rounded-lg shrink-0 ${
                  isCrash ? 'bg-red-50' : 'bg-green-50'
                }`}>
                  {isCrash
                    ? <TrendingDown size={13} className="text-red-600" />
                    : <TrendingUp size={13} className="text-green-600" />
                  }
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-gray-900">
                      {INDEX_LABELS[signal.indice] ?? signal.indice}
                    </span>
                    <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded-md ${
                      isCrash
                        ? 'text-red-600 bg-red-50'
                        : 'text-green-600 bg-green-50'
                    }`}>
                      {isCrash ? 'SELL' : 'BUY'}
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 font-mono mt-0.5">
                    {formatDistanceToNow(signal.timestamp)}
                  </p>
                </div>
              </div>
              <span className="text-sm font-mono font-medium text-gray-600">
                {(signal.precioActual ?? 0).toFixed(4)}
              </span>
            </div>

            {/* Timeframe stochastics */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: '1H',  k: signal.stoch1H_K,  d: signal.stoch1H_D  },
                { label: '15M', k: signal.stoch15M_K, d: signal.stoch15M_D },
                { label: '5M',  k: signal.stoch5M_K,  d: signal.stoch5M_D  },
              ].map(({ label, k, d }) => (
                <div key={label} className="bg-gray-50 rounded-xl p-2.5">
                  <p className="text-[9px] font-semibold tracking-widest uppercase text-gray-400 mb-1.5">{label}</p>
                  <p className="text-xs font-mono text-gray-900">K {(k ?? 50).toFixed(1)}</p>
                  <p className="text-xs font-mono text-gray-500">D {(d ?? 50).toFixed(1)}</p>
                </div>
              ))}
            </div>

            {/* Trend */}
            <div className="mt-2.5 flex items-center gap-2">
              <span className="text-xs text-gray-400">Tendencia</span>
              <span className={`text-xs font-mono font-bold ${
                signal.tendencia === 'ALCISTA' ? 'text-green-600'
                : signal.tendencia === 'BAJISTA' ? 'text-red-600'
                : 'text-gray-400'
              }`}>
                {signal.tendencia}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
