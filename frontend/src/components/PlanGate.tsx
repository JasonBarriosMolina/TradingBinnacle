import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import type { Plan } from '../shared/types'

interface PlanGateProps {
  requiredPlan: Plan
  children: ReactNode
  fallback?: ReactNode
}

const PLAN_ORDER: Record<Plan, number> = { free: 0, pro: 1 }
const PLAN_NAMES: Record<Plan, string> = { free: 'Free', pro: 'Pro' }

export function PlanGate({ requiredPlan, children, fallback }: PlanGateProps) {
  const { user } = useAuthStore()
  const currentPlan = user?.plan ?? 'free'

  if (PLAN_ORDER[currentPlan] >= PLAN_ORDER[requiredPlan]) {
    return <>{children}</>
  }

  if (fallback) return <>{fallback}</>

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
      <div className="w-14 h-14 rounded-full bg-[#161B22] border border-[#21262D] flex items-center justify-center">
        <Lock size={24} className="text-[#7D8590]" />
      </div>
      <div>
        <p className="text-[#E6EDF3] font-semibold text-lg">Plan {PLAN_NAMES[requiredPlan]} requerido</p>
        <p className="text-[#7D8590] text-sm mt-1">
          Esta funcionalidad requiere el plan {PLAN_NAMES[requiredPlan]} o superior.
        </p>
      </div>
      <Link
        to="/settings"
        className="px-4 py-2 bg-[#388BFD] hover:bg-[#58A6FF] text-white text-sm font-medium rounded-md transition-colors"
      >
        Ver planes
      </Link>
    </div>
  )
}
