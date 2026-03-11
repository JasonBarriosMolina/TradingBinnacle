import { useState } from 'react'
import { derivWS } from '../lib/derivApi'
import { api } from '../lib/api'
import { useAuthStore } from '../store/authStore'

export function useDerivAuth() {
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { user, updateUser } = useAuthStore()

  const connectWithApiKey = async (apiKey: string): Promise<boolean> => {
    setConnecting(true)
    setError(null)
    try {
      await derivWS.connect()
      const res = await derivWS.request<{
        authorize: { loginid: string; email: string; is_virtual: 0 | 1 }
      }>({ authorize: apiKey })
      const acct = res.authorize
      const accountType = acct.is_virtual === 1 ? 'demo' : 'real'
      await api.post('/auth/deriv-token', {
        derivToken: apiKey,
        derivLoginId: acct.loginid,
        derivAccountType: accountType,
      })
      updateUser({
        derivLoginId: acct.loginid,
        derivAccountType: accountType,
      })
      return true
    } catch (e: unknown) {
      let msg = e instanceof Error ? e.message : 'Error desconocido'
      if (msg.toLowerCase().includes('invalid token') || msg.toLowerCase().includes('input validation failed')) {
        msg = 'API Key inválido. Verifica que copiaste el token completo desde Deriv sin espacios extras.'
      } else if (msg.toLowerCase().includes('ratelimit') || msg.toLowerCase().includes('rate limit')) {
        msg = 'Demasiados intentos. Espera unos segundos e intenta de nuevo.'
      } else if (msg.toLowerCase().includes('notauthorized') || msg.toLowerCase().includes('not authorized')) {
        msg = 'Token sin permisos. El API Key necesita los scopes "Read" y "Trading Information".'
      }
      setError(msg)
      return false
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    await api.delete('/auth/deriv-token')
    updateUser({ derivToken: undefined, derivLoginId: undefined })
    derivWS.disconnect()
  }

  return {
    isConnected: !!user?.derivLoginId,
    loginId: user?.derivLoginId,
    accountType: user?.derivAccountType,
    connecting,
    error,
    connectWithApiKey,
    disconnect,
  }
}
