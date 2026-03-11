import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { tradesApi } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { PLAN_LIMITS } from '../shared/types'

interface TradeFilters {
  indice?: string
  resultado?: string
  fecha?: string
  page?: number
}

export function useTrades(filters: TradeFilters = {}) {
  return useQuery({
    queryKey: ['trades', filters],
    queryFn: () => tradesApi.getAll(filters).then((r) => r.data),
    staleTime: 60_000,
  })
}

export function useTrade(tradeId: string) {
  return useQuery({
    queryKey: ['trade', tradeId],
    queryFn: () => tradesApi.getById(tradeId).then((r) => r.data),
    enabled: !!tradeId,
  })
}

export function useTradeCandles(tradeId: string) {
  return useQuery({
    queryKey: ['trade-candles', tradeId],
    queryFn: () => tradesApi.getCandles(tradeId).then((r) => r.data),
    enabled: !!tradeId,
    staleTime: 5 * 60_000, // 5 min — candles don't change for historical trades
  })
}

export function useSyncTrades() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isMT5 = !!user?.metaApiAccountId
  return useMutation({
    mutationFn: () => isMT5
      ? tradesApi.mt5SyncNow().then((r) => r.data)
      : tradesApi.sync().then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function useSyncHistory() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isMT5 = !!user?.metaApiAccountId
  return useMutation({
    mutationFn: () => isMT5
      ? tradesApi.mt5SyncHistory().then((r) => r.data)
      : tradesApi.syncHistory().then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trades'] })
      qc.invalidateQueries({ queryKey: ['stats'] })
    },
  })
}

export function usePlanLimits() {
  const { user } = useAuthStore()
  const plan = user?.plan ?? 'free'
  return PLAN_LIMITS[plan]
}

export function useTrialInfo() {
  const { user } = useAuthStore()
  if (!user) return { isTrial: false, daysLeft: 0, isExpired: false }

  const trialEnd = new Date(user.trialEndsAt)
  const now = new Date()
  const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000))
  const isTrial = user.status === 'trial'
  const isExpired = isTrial && daysLeft === 0

  return { isTrial, daysLeft, isExpired }
}
