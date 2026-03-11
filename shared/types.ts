// ─── Plan & Status ─────────────────────────────────────────────────────────────
export type Plan = 'free' | 'pro'
export type UserStatus = 'trial' | 'pending' | 'active' | 'suspended'
export type AccountType = 'demo' | 'real'

// ─── Plan Limits ───────────────────────────────────────────────────────────────
export const PLAN_LIMITS: Record<Plan, PlanConfig> = {
  free: {
    maxTrades: 30,
    mt5Sync: false,
    signals: false,
    exportData: false,
    multipleIndices: false,
  },
  pro: {
    maxTrades: Infinity,
    mt5Sync: true,
    signals: true,
    exportData: true,
    multipleIndices: true,
  },
}

export interface PlanConfig {
  maxTrades: number
  mt5Sync: boolean
  signals: boolean
  exportData: boolean
  multipleIndices: boolean
}

// ─── Synthetic Indices ─────────────────────────────────────────────────────────
export type IndexSymbol =
  | 'CRASH_300' | 'CRASH_500' | 'CRASH_600' | 'CRASH_900' | 'CRASH_1000'
  | 'BOOM_300'  | 'BOOM_500'  | 'BOOM_600'  | 'BOOM_900'  | 'BOOM_1000'

export type SignalType = 'CRASH' | 'BOOM'
export type Direction = 'BUY' | 'SELL'
export type TradeResult = 'WIN' | 'LOSS'
export type Trend = 'BAJISTA' | 'ALCISTA' | 'LATERAL'
export type EMASignal = 'BEARISH' | 'BULLISH' | 'NEUTRAL'
export type StochZone = 'SOBRECOMPRA' | 'NEUTRAL' | 'SOBREVENTA'

// Symbols accepted by Deriv's ticks_history / market data API (from active_symbols query)
// Note: only 300-series have the N suffix; others use the plain name
export const DERIV_SYMBOLS: Record<IndexSymbol, string> = {
  CRASH_300:  'CRASH300N',
  CRASH_500:  'CRASH500',
  CRASH_600:  'CRASH600',
  CRASH_900:  'CRASH900',
  CRASH_1000: 'CRASH1000',
  BOOM_300:   'BOOM300N',
  BOOM_500:   'BOOM500',
  BOOM_600:   'BOOM600',
  BOOM_900:   'BOOM900',
  BOOM_1000:  'BOOM1000',
}

// All supported indices in display order
export const ALL_INDICES: IndexSymbol[] = [
  'CRASH_300', 'CRASH_500', 'CRASH_600', 'CRASH_900', 'CRASH_1000',
  'BOOM_300',  'BOOM_500',  'BOOM_600',  'BOOM_900',  'BOOM_1000',
]

// MT5 (MetaApi) uses human-readable symbol names
export const MT5_TO_INDEX: Record<string, IndexSymbol> = {
  'Crash 300 Index':  'CRASH_300',
  'Crash 500 Index':  'CRASH_500',
  'Crash 600 Index':  'CRASH_600',
  'Crash 900 Index':  'CRASH_900',
  'Crash 1000 Index': 'CRASH_1000',
  'Boom 300 Index':   'BOOM_300',
  'Boom 500 Index':   'BOOM_500',
  'Boom 600 Index':   'BOOM_600',
  'Boom 900 Index':   'BOOM_900',
  'Boom 1000 Index':  'BOOM_1000',
}

export const INDEX_LABELS: Record<IndexSymbol, string> = {
  CRASH_300:  'Crash 300',
  CRASH_500:  'Crash 500',
  CRASH_600:  'Crash 600',
  CRASH_900:  'Crash 900',
  CRASH_1000: 'Crash 1000',
  BOOM_300:   'Boom 300',
  BOOM_500:   'Boom 500',
  BOOM_600:   'Boom 600',
  BOOM_900:   'Boom 900',
  BOOM_1000:  'Boom 1000',
}

// ─── User ──────────────────────────────────────────────────────────────────────
export interface User {
  userId: string
  email: string
  name: string
  plan: Plan
  status: UserStatus
  trialEndsAt: string
  subscriptionPrice: number
  derivToken?: string
  derivAccountType?: AccountType
  derivLoginId?: string
  metaApiAccountId?: string
  mt5LoginId?: string
  mt5Server?: string
  mt5AccountType?: AccountType
  mt5LastSync?: string
  subscriptionStart?: string
  subscriptionEnd?: string
  createdAt: string
  watchlist: IndexSymbol[]
  pushSubscription?: PushSubscriptionData
  telegramChatId?: string
  telegramLinkCode?: string
  telegramLinkCodeExpires?: string
}

export interface PushSubscriptionData {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

// ─── Trade (Bitácora) ──────────────────────────────────────────────────────────
export interface Trade {
  tradeId: string
  userId: string
  fecha: string
  horaEntrada: string
  horaCierre: string
  duracionMinutos: number
  cuenta: AccountType
  indice: IndexSymbol
  direccion: Direction
  precioEntrada: number
  precioCierre: number
  stake: number
  gananciaUSD: number
  resultado: TradeResult
  stochK_entrada: number
  stochD_entrada: number
  stochZona: StochZone
  stochCruce: boolean
  senalValida: boolean
  tendencia: Trend
  ema20_vs_ema50: EMASignal
  confluencia1H: boolean
  confluencia15M: boolean
  confluencia5M: boolean
  graficoPngUrl?: string
  numeroDia: number
  balanceDia: number
  capitalInicial: number
}

// ─── Signal ────────────────────────────────────────────────────────────────────
export interface Signal {
  indice: IndexSymbol
  tipo: SignalType
  stoch1H_K: number
  stoch1H_D: number
  stoch15M_K: number
  stoch15M_D: number
  stoch5M_K: number
  stoch5M_D: number
  tendencia: Trend
  ema20: number
  ema50: number
  precioActual: number
  timestamp: string
  notificadoA: string[]
}

// ─── Candle ────────────────────────────────────────────────────────────────────
export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
}

// ─── Stochastic ────────────────────────────────────────────────────────────────
export interface StochResult {
  k: number[]
  d: number[]
}

// ─── API Responses ────────────────────────────────────────────────────────────
export interface ApiResponse<T> {
  success: boolean
  data?: T
  error?: string
}

export interface TradesResponse {
  trades: Trade[]
  total: number
  hasMore: boolean
}

export interface StatsData {
  winrateGeneral: number
  winratePorIndice: Record<IndexSymbol, number>
  winratePorDireccion: Record<Direction, number>
  winrateConSenal: number
  winrateSinSenal: number
  pnlTotal: number
  pnlPorSemana: { week: string; pnl: number }[]
  pnlPorMes: { month: string; pnl: number }[]
  mejorTrade: Trade | null
  peorTrade: Trade | null
  totalTrades: number
  tradesConStoch: number
}

// ─── Deriv API ────────────────────────────────────────────────────────────────
export interface DerivAccount {
  loginid: string
  token: string
  account_type: string
  currency: string
  balance?: number
}

export interface DerivStatement {
  statement: {
    transactions: DerivTransaction[]
  }
}

export interface DerivTransaction {
  contract_id: number
  action_type: string
  amount: number
  balance_after: number
  purchase_time: number
  transaction_time: number
  shortcode?: string
}
