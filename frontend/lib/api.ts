import { getToken } from "./auth";

const API_URL = process.env.NEXT_PUBLIC_API_URL;

async function authHeaders(): Promise<HeadersInit> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${text}`);
  }

  const contentType = res.headers.get("Content-Type") ?? "";
  if (contentType.includes("application/json")) {
    return res.json() as Promise<T>;
  }
  return null as T;
}

export interface Trade {
  tradeId: string;
  userId: string;
  indice: string;
  direccion: "BUY" | "SELL";
  resultado: "WIN" | "LOSS" | "OPEN";
  fecha: string;
  hora?: string;
  entrada?: number;
  salida?: number;
  pnl?: number;
  stoch1H?: { k: number; d: number };
  stoch5M?: { k: number; d: number };
  stoch1M?: { k: number; d: number };
  notas?: string;
  tipo: "real" | "backtest" | "auto";
  signalId?: string;
  createdAt: string;
}

export interface Signal {
  signalId: string;
  /** Internal symbol key, e.g. CRASH300N */
  symbol?: string;
  /** Alias: same as symbol, mapped from DynamoDB */
  indice: string;
  direccion: "BUY" | "SELL";
  entrada: number;
  sl: number;
  tp: number;
  slPuntos?: number;
  tpPuntos?: number;
  stoch1H?: { k: number; d: number };
  stoch5M?: { k: number; d: number };
  stoch1M?: { k: number; d: number } | null;
  status: "open" | "closed" | "skipped";
  createdAt: string;
  created_at?: string;
  resultado?: "WIN" | "LOSS";
  finalScore?: number;
  sagemakerScore?: number | null;
  bedrockScore?: number | null;
  journalScore?: number | null;
  scoreFallback?: boolean;
  scoreReason?: string | null;
}

export interface StatsSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  pnlWeek: number;
  pnlTotal: number;
  capital: number;
  rrPromedio: number;
  rachaActual: number;
  rachaPositiva: number;
  rachaNegativa: boolean;
  lotajeSugerido: number;
}

export interface EquityPoint {
  fecha: string;
  pnl: number;
  cumulative: number;
}

export interface AdminUser {
  userId: string;
  email: string;
  plan: string;
  plan_expires?: string;
  plan_source?: string;
  created_at?: string;
  tradeCount?: number;
}

export interface TradeParams {
  indice?: string;
  resultado?: string;
  tipo?: string;
  desde?: string;
  hasta?: string;
  limit?: number;
  lastKey?: string;
}

export const api = {
  trades: {
    list: (params?: TradeParams) => {
      const qs = params
        ? "?" + new URLSearchParams(params as Record<string, string>).toString()
        : "";
      return request<{ trades: Trade[]; lastKey?: string }>(`/trades${qs}`);
    },
    create: (body: Partial<Trade>) =>
      request<Trade>("/trades", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (tradeId: string, body: Partial<Trade>) =>
      request<Trade>(`/trades/${tradeId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    delete: (tradeId: string) =>
      request<void>(`/trades/${tradeId}`, { method: "DELETE" }),
    mt5SyncNow: () =>
      request<{ synced: number }>("/trades/mt5-sync-now", { method: "POST" }),
  },

  signals: {
    list: (params?: { status?: string; indice?: string; limit?: number }) => {
      const qs = params
        ? "?" + new URLSearchParams(params as Record<string, string>).toString()
        : "";
      return request<{ signals: Signal[] }>(`/signals${qs}`);
    },
    get: (signalId: string) =>
      request<Signal>(`/signals/${signalId}`),
  },

  stats: {
    summary: () => request<StatsSummary>("/stats"),
    equity: () => request<{ points: EquityPoint[] }>("/stats/equity"),
  },

  admin: {
    users: () => request<{ users: AdminUser[] }>("/admin/users"),
    updatePlan: (userId: string, body: { plan: string; months?: number }) =>
      request<{ ok: boolean }>(`/admin/users/${userId}/plan`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    metrics: () => request<Record<string, unknown>>("/admin/metrics"),
  },

  copilot: {
    chat: (body: { message: string; history?: { role: string; content: string }[] }) =>
      request<{ reply: string; context: Record<string, unknown> }>("/copilot", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    suggestions: () =>
      request<{ suggestions: string[] }>("/copilot/suggestions"),
  },
};

export const INDEX_CONFIG = [
  { value: "CRASH300N",  label: "Crash 300",  type: "crash" },
  { value: "CRASH500N",  label: "Crash 500",  type: "crash" },
  { value: "CRASH600N",  label: "Crash 600",  type: "crash" },
  { value: "CRASH900N",  label: "Crash 900",  type: "crash" },
  { value: "CRASH1000N", label: "Crash 1000", type: "crash" },
  { value: "BOOM300N",   label: "Boom 300",   type: "boom"  },
  { value: "BOOM500N",   label: "Boom 500",   type: "boom"  },
  { value: "BOOM600N",   label: "Boom 600",   type: "boom"  },
  { value: "BOOM900N",   label: "Boom 900",   type: "boom"  },
  { value: "BOOM1000N",  label: "Boom 1000",  type: "boom"  },
] as const;

export type IndexValue = (typeof INDEX_CONFIG)[number]["value"];
