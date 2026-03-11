import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { signalsApi } from '../lib/api'
import { useAuthStore } from '../store/authStore'
import type { IndexSymbol } from '../shared/types'

export function useSignals() {
  const { user } = useAuthStore()
  return useQuery({
    queryKey: ['signals'],
    queryFn: () => signalsApi.getRecent().then((r) => r.data),
    refetchInterval: 60_000,
    enabled: user?.plan === 'pro',
  })
}

export function useUpdateWatchlist() {
  const qc = useQueryClient()
  const { updateUser } = useAuthStore()
  return useMutation({
    mutationFn: (watchlist: IndexSymbol[]) =>
      signalsApi.updateWatchlist(watchlist).then((r) => r.data),
    onSuccess: (_, watchlist) => {
      updateUser({ watchlist })
      qc.invalidateQueries({ queryKey: ['signals'] })
    },
  })
}

export function useRequestPushPermission() {
  return async (): Promise<boolean> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return false

    const reg = await navigator.serviceWorker.ready
    const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC).buffer as ArrayBuffer,
    })

    const subData = sub.toJSON() as {
      endpoint: string
      keys: { p256dh: string; auth: string }
    }

    await signalsApi.savePushSubscription(subData)
    return true
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return new Uint8Array([...rawData].map((c) => c.charCodeAt(0)))
}
