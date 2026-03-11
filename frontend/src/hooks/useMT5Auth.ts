import { useState } from 'react'
import { authApi } from '../lib/api'
import { useAuthStore } from '../store/authStore'

function parseError(e: unknown): string {
  if (e instanceof Error) return e.message
  return 'Error desconocido'
}

export function useMT5Auth() {
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user, updateUser } = useAuthStore()

  const connect = async (login: string, password: string, server: string): Promise<boolean> => {
    setConnecting(true)
    setError(null)
    try {
      const res = await authApi.saveMt5Credentials({ login, password, server })
      updateUser({
        metaApiAccountId: res.data.metaApiAccountId,
        mt5LoginId:       res.data.mt5LoginId,
        mt5AccountType:   res.data.mt5AccountType as 'demo' | 'real',
        mt5Server:        res.data.mt5Server,
      })
      return true
    } catch (e) {
      setError(parseError(e))
      return false
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    setDisconnecting(true)
    try {
      await authApi.deleteMt5Credentials()
      updateUser({
        metaApiAccountId: undefined,
        mt5LoginId:       undefined,
        mt5Server:        undefined,
        mt5AccountType:   undefined,
      })
    } finally {
      setDisconnecting(false)
    }
  }

  return {
    isConnected:   !!user?.metaApiAccountId,
    loginId:       user?.mt5LoginId,
    server:        user?.mt5Server,
    accountType:   user?.mt5AccountType,
    lastSync:      user?.mt5LastSync,
    connecting,
    disconnecting,
    error,
    connect,
    disconnect,
  }
}
