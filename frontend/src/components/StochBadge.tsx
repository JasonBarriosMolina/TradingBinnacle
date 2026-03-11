import { getStochZone } from '../lib/stochCalc'
import type { StochZone } from '../shared/types'

interface StochBadgeProps {
  k: number
  d?: number
  hasCross?: boolean
  size?: 'sm' | 'md'
}

const ZONE_COLORS: Record<StochZone, string> = {
  SOBRECOMPRA: 'text-[#F85149] bg-[#F85149]/10 border-[#F85149]/30',
  SOBREVENTA: 'text-[#2EA043] bg-[#2EA043]/10 border-[#2EA043]/30',
  NEUTRAL: 'text-[#7D8590] bg-[#7D8590]/10 border-[#7D8590]/30',
}

const ZONE_LABELS: Record<StochZone, string> = {
  SOBRECOMPRA: 'OB',
  SOBREVENTA: 'OS',
  NEUTRAL: 'NEU',
}

export function StochBadge({ k, d, hasCross, size = 'sm' }: StochBadgeProps) {
  const kVal = k ?? 50
  const zone = getStochZone(kVal)
  const colorClass = ZONE_COLORS[zone]
  const label = ZONE_LABELS[zone]
  const textSize = size === 'sm' ? 'text-xs' : 'text-sm'
  const padding = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-1'

  return (
    <div className="flex items-center gap-1.5">
      <span className={`font-mono ${textSize} ${padding} rounded border ${colorClass} font-medium`}>
        {label}
      </span>
      <span className={`font-mono ${textSize} text-[#2EA043]`}>
        K:{kVal.toFixed(1)}
      </span>
      {d !== undefined && d !== null && (
        <span className={`font-mono ${textSize} text-[#F85149]`}>
          D:{(d ?? 50).toFixed(1)}
        </span>
      )}
      {hasCross && (
        <span className={`font-mono ${textSize} text-[#D29922]`} title="Cruce detectado">
          ✕
        </span>
      )}
    </div>
  )
}
