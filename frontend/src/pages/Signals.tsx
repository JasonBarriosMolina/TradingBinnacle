import { useState } from 'react'
import { Bell, Radio } from 'lucide-react'
import { useSignals, useUpdateWatchlist, useRequestPushPermission } from '../hooks/useSignals'
import { SignalFeed } from '../components/SignalFeed'
import { PlanGate } from '../components/PlanGate'
import { useAuthStore } from '../store/authStore'
import { ALL_INDICES, INDEX_LABELS } from '../shared/types'
import type { IndexSymbol } from '../shared/types'

function SignalsContent() {
  const { user } = useAuthStore()
  const { data: signals = [], isLoading, dataUpdatedAt } = useSignals()
  const updateWatchlist = useUpdateWatchlist()
  const requestPush = useRequestPushPermission()
  const [pushStatus, setPushStatus] = useState<'idle' | 'success' | 'denied'>('idle')
  const watchlist: IndexSymbol[] = user?.watchlist ?? ALL_INDICES

  const toggleIndex = (index: IndexSymbol) => {
    const next = watchlist.includes(index)
      ? watchlist.filter((i) => i !== index)
      : [...watchlist, index]
    updateWatchlist.mutate(next)
  }

  const handleEnablePush = async () => {
    const ok = await requestPush()
    setPushStatus(ok ? 'success' : 'denied')
  }

  return (
    <div className="pb-4">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#eeeeee] px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Radio size={14} className="text-[#ff8a71]" />
          <div>
            <h1 className="text-base font-bold text-[#1a1a2e]">Señales</h1>
            {dataUpdatedAt > 0 && (
              <p className="text-xs text-[#6c6d84]">
                {new Date(dataUpdatedAt).toLocaleTimeString('es-CR')}
              </p>
            )}
          </div>
        </div>
        {pushStatus === 'success' ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-green-600">
            <Bell size={12} /> Activas
          </span>
        ) : (
          <button
            onClick={handleEnablePush}
            className={`flex items-center gap-1.5 text-xs font-semibold px-4 h-9 rounded-full transition-all ${
              pushStatus === 'denied'
                ? 'bg-red-50 border border-red-200 text-red-500'
                : 'bg-[#f5fafb] border border-[#eeeeee] text-[#6c6d84] hover:border-[#ff8a71] hover:text-[#ff8a71]'
            }`}
          >
            <Bell size={12} />
            {pushStatus === 'denied' ? 'Bloqueadas' : 'Notificaciones'}
          </button>
        )}
      </div>

      <div className="px-5 pt-5 space-y-4">

        {/* ── Watchlist ── */}
        <div className="bg-white border border-[#eeeeee] rounded-2xl p-4">
          <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-3">
            Índices monitoreados
          </p>
          <div className="flex gap-2 flex-wrap">
            {ALL_INDICES.map((index) => {
              const active = watchlist.includes(index)
              return (
                <button
                  key={index}
                  onClick={() => toggleIndex(index)}
                  disabled={updateWatchlist.isPending}
                  className={`px-3 py-1.5 text-xs font-semibold rounded-full border transition-all ${
                    active
                      ? 'bg-[#ff8a71] border-[#ff8a71] text-white'
                      : 'bg-transparent border-[#eeeeee] text-[#6c6d84] hover:border-[#ff8a71] hover:text-[#ff8a71]'
                  }`}
                >
                  {INDEX_LABELS[index]}
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Signal conditions ── */}
        <div className="bg-white border border-[#eeeeee] rounded-2xl p-4">
          <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-3">
            Condiciones de señal
          </p>
          <div className="grid grid-cols-2 gap-4 text-xs text-[#6c6d84]">
            <div>
              <p className="font-bold text-red-500 mb-2">CRASH · SELL</p>
              <ul className="space-y-1.5">
                <li>• Estocástico en sobrecompra (1H, 15M, 5M &gt; 80)</li>
                <li>• Cruce bajista del estocástico en 5M</li>
                <li>• Tendencia bajista (media rápida bajo media lenta)</li>
              </ul>
            </div>
            <div>
              <p className="font-bold text-green-600 mb-2">BOOM · BUY</p>
              <ul className="space-y-1.5">
                <li>• Estocástico en sobreventa (1H, 15M, 5M &lt; 20)</li>
                <li>• Cruce alcista del estocástico en 5M</li>
                <li>• Tendencia alcista (media rápida sobre media lenta)</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ── Signal feed ── */}
        {isLoading ? (
          <div className="bg-white border border-[#eeeeee] rounded-2xl overflow-hidden divide-y divide-[#eeeeee] animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 bg-[#f5fafb]" />
            ))}
          </div>
        ) : (
          <SignalFeed signals={signals.filter((s) => watchlist.includes(s.indice))} />
        )}

      </div>
    </div>
  )
}

export function Signals() {
  return (
    <PlanGate requiredPlan="pro">
      <SignalsContent />
    </PlanGate>
  )
}
