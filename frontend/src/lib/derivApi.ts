import type { Candle } from '../shared/types'

const DERIV_APP_ID = import.meta.env.VITE_DERIV_APP_ID ?? '1089'
const WS_URL = `wss://ws.binaryws.com/websockets/v3?app_id=${DERIV_APP_ID}`
const CONNECT_TIMEOUT_MS = 12_000

type MessageHandler = (data: Record<string, unknown>) => void

class DerivWebSocket {
  private ws: WebSocket | null = null
  private handlers = new Map<string, MessageHandler[]>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private token: string | null = null

  connect(token?: string): Promise<void> {
    // Close any existing connection before opening a new one
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.onclose = null // prevent auto-reconnect loop
      this.ws.close()
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    this.token = token ?? null

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Tiempo de conexión agotado. Verifica tu internet.')),
        CONNECT_TIMEOUT_MS,
      )

      this.ws = new WebSocket(WS_URL)

      this.ws.onopen = () => {
        clearTimeout(timeout)
        // Do NOT auto-send authorize here — let the caller use request()
        // to avoid double-authorize race conditions.
        resolve()
      }

      this.ws.onerror = () => {
        clearTimeout(timeout)
        reject(new Error('Error de conexión con Deriv. Inténtalo de nuevo.'))
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as Record<string, unknown>

          // Find the primary message type key.
          // For success responses: the key IS the msg_type (e.g. 'authorize', 'tick').
          // For error responses: Deriv only returns {error, echo_req, msg_type},
          // so we fall back to data.msg_type to route the error to the right handler.
          const msgType =
            Object.keys(data).find(
              (k) => !['echo_req', 'req_id', 'msg_type', 'error'].includes(k),
            ) ?? (data.msg_type as string | undefined)

          if (msgType) {
            const list = this.handlers.get(msgType) ?? []
            list.forEach((h) => h(data))
          }
        } catch {
          // ignore malformed frames
        }
      }

      this.ws.onclose = () => {
        // Only auto-reconnect after the initial connect promise has settled
        clearTimeout(timeout)
        this.reconnectTimer = setTimeout(
          () => this.connect(this.token ?? undefined),
          5000,
        )
      }
    })
  }

  send(data: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data))
    }
  }

  on(msgType: string, handler: MessageHandler): () => void {
    const list = this.handlers.get(msgType) ?? []
    list.push(handler)
    this.handlers.set(msgType, list)
    return () => {
      const updated = (this.handlers.get(msgType) ?? []).filter((h) => h !== handler)
      this.handlers.set(msgType, updated)
    }
  }

  request<T = Record<string, unknown>>(data: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const reqId = Date.now()
      const msgType = Object.keys(data)[0]

      const unsub = this.on(msgType, (res) => {
        if (res.error) {
          unsub()
          const errObj = res.error as { message?: string; code?: string }
          reject(new Error(errObj.message ?? 'Error desconocido de Deriv'))
          return
        }
        unsub()
        resolve(res as T)
      })

      this.send({ ...data, req_id: reqId })
    })
  }

  disconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.ws) {
      this.ws.onclose = null // prevent auto-reconnect
      this.ws.close()
      this.ws = null
    }
    this.token = null
  }
}

export const derivWS = new DerivWebSocket()

// ─── Public helpers ───────────────────────────────────────────────────────────
export async function getCandles(
  symbol: string,
  granularity: number,
  count: number,
): Promise<Candle[]> {
  const res = await derivWS.request<{
    candles: Array<{ epoch: number; open: string; high: string; low: string; close: string }>
  }>({
    ticks_history: symbol,
    style: 'candles',
    granularity,
    count,
    end: 'latest',
  })
  return (res.candles ?? []).map((c) => ({
    time: c.epoch,
    open: parseFloat(c.open as unknown as string),
    high: parseFloat(c.high as unknown as string),
    low: parseFloat(c.low as unknown as string),
    close: parseFloat(c.close as unknown as string),
  }))
}

export async function getActiveSymbols(): Promise<Array<{ symbol: string; display_name: string }>> {
  const res = await derivWS.request<{
    active_symbols: Array<{ symbol: string; display_name: string }>
  }>({
    active_symbols: 'brief',
    product_type: 'basic',
  })
  return res.active_symbols ?? []
}

export function getOAuthUrl(): string {
  return `https://oauth.deriv.com/oauth2/authorize?app_id=${DERIV_APP_ID}&l=ES`
}
