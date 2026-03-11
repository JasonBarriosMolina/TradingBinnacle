import axios from 'axios'
import { useAuthStore } from '../store/authStore'

const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3001'

export const api = axios.create({
  baseURL: BASE_URL,
  headers: { 'Content-Type': 'application/json' },
})

// Attach auth token automatically
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().idToken
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 → try refresh token first, then clear auth
let isRefreshing = false
let refreshQueue: Array<(token: string) => void> = []

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true
      const { refreshToken, setTokens, clearAuth } = useAuthStore.getState()

      if (refreshToken) {
        if (isRefreshing) {
          // Wait for the in-progress refresh
          return new Promise((resolve) => {
            refreshQueue.push((newIdToken) => {
              original.headers.Authorization = `Bearer ${newIdToken}`
              resolve(api(original))
            })
          })
        }

        isRefreshing = true
        try {
          const res = await api.post('/auth/refresh-token', { refreshToken })
          const { accessToken, idToken } = res.data
          setTokens(accessToken, idToken)
          isRefreshing = false
          refreshQueue.forEach((cb) => cb(idToken))
          refreshQueue = []
          original.headers.Authorization = `Bearer ${idToken}`
          return api(original)
        } catch {
          isRefreshing = false
          refreshQueue = []
          clearAuth()
          window.location.href = '/login'
        }
      } else {
        clearAuth()
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  },
)

// ─── Auth endpoints ───────────────────────────────────────────────────────────
export const authApi = {
  register: (data: { name: string; email: string; password: string }) =>
    api.post('/auth/register', data),

  login: (data: { email: string; password: string }) =>
    api.post<{ accessToken: string; idToken: string; refreshToken: string; user: import('../shared/types').User }>(
      '/auth/login',
      data,
    ),

  forgotPassword: (email: string) => api.post('/auth/forgot-password', { email }),

  confirmResetPassword: (data: { email: string; code: string; newPassword: string }) =>
    api.post('/auth/confirm-reset-password', data),

  getMe: () => api.get<import('../shared/types').User>('/auth/me'),

  saveMt5Credentials: (data: { login: string; password: string; server: string }) =>
    api.post<{ metaApiAccountId: string; mt5LoginId: string; mt5Server: string; mt5AccountType: string }>(
      '/auth/mt5-credentials',
      data,
    ),

  deleteMt5Credentials: () => api.delete('/auth/mt5-credentials'),
}

// ─── Trades endpoints ─────────────────────────────────────────────────────────
export const tradesApi = {
  getAll: (params?: { indice?: string; resultado?: string; fecha?: string; page?: number }) =>
    api.get<import('../shared/types').TradesResponse>('/trades', { params }),

  getById: (tradeId: string) =>
    api.get<import('../shared/types').Trade>(`/trades/${tradeId}`),

  sync: () => api.post<{ queued?: boolean; synced: number }>('/trades/sync'),

  syncHistory: () =>
    api.post<{ queued?: boolean; synced: number; total: number; skipped: number; errors: number }>(
      '/trades/sync-history',
    ),

  mt5SyncNow: () => api.post<{ queued?: boolean; synced: number; errors: number; total: number; skipped: number }>('/trades/mt5-sync-now'),

  mt5SyncHistory: () =>
    api.post<{ queued?: boolean; synced: number; errors: number; total: number; skipped: number }>('/trades/mt5-sync-history'),

  getCandles: (tradeId: string) =>
    api.get<{
      candles: { time: number; open: number; high: number; low: number; close: number }[]
      entryEpoch: number
      exitEpoch?: number
      entryPrice: number
      exitPrice: number
    }>(`/trades/${tradeId}/candles`),
}

// ─── Signals endpoints ────────────────────────────────────────────────────────
export const signalsApi = {
  getRecent: () =>
    api.get<import('../shared/types').Signal[]>('/signals'),

  updateWatchlist: (watchlist: import('../shared/types').IndexSymbol[]) =>
    api.put('/signals/watchlist', { watchlist }),

  savePushSubscription: (subscription: import('../shared/types').PushSubscriptionData) =>
    api.post('/signals/push-subscription', subscription),
}

// ─── Telegram endpoints ───────────────────────────────────────────────────────
export const telegramApi = {
  getLinkCode: () =>
    api.get<{ code: string; botUsername: string; expiresAt: string }>('/telegram/link-code'),

  disconnect: () => api.delete('/telegram/disconnect'),
}

// ─── Stats endpoint ───────────────────────────────────────────────────────────
export const statsApi = {
  get: () => api.get<import('../shared/types').StatsData>('/stats'),
}

// ─── Admin endpoints ──────────────────────────────────────────────────────────
export const adminApi = {
  getUsers: () => api.get<import('../shared/types').User[]>('/admin/users'),
  updateUser: (userId: string, data: Partial<import('../shared/types').User>) =>
    api.put(`/admin/users/${userId}`, data),
}
