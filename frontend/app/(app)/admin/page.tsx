"use client";

import React, { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";

interface AdminUser {
  userId: string;
  email: string;
  plan: string;
  plan_expires?: string;
  plan_source?: string;
  created_at?: string;
}

interface Metrics {
  total_users: number;
  by_plan: { free: number; pro: number; elite: number };
  new_this_week: number;
  mrr_estimate: number;
}

// ── Stat cards ────────────────────────────────────────────────────────────────
function MetricCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "#0f1520", border: "1px solid #1a2035" }}
    >
      <p className="text-[10px] text-dim uppercase tracking-wider mb-1">{label}</p>
      <p
        className="text-xl font-bold tabular-nums"
        style={{ color: color || "#e2e8f0" }}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-dim mt-0.5">{sub}</p>}
    </div>
  );
}

// ── Plan badge ────────────────────────────────────────────────────────────────
function PlanBadge({ plan }: { plan: string }) {
  const colors: Record<string, string> = {
    free: "#4a5570",
    pro: "#508cff",
    elite: "#ffd060",
    trial: "#00e5a0",
  };
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded uppercase tracking-wide"
      style={{
        color: colors[plan] || "#4a5570",
        background: `${colors[plan] || "#4a5570"}18`,
      }}
    >
      {plan}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AdminPage() {
  const [users, setUsers]       = useState<AdminUser[]>([]);
  const [metrics, setMetrics]   = useState<Metrics | null>(null);
  const [loading, setLoading]   = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);
  const [search, setSearch]     = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, metricsRes] = await Promise.all([
        api.admin.users(),
        api.admin.metrics(),
      ]);
      setUsers((usersRes as { users: AdminUser[] }).users ?? []);
      setMetrics(metricsRes as unknown as Metrics);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando datos admin");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function changePlan(userId: string, plan: string, months: number) {
    setUpdating(userId);
    try {
      await api.admin.updatePlan(userId, { plan, months } as { plan: string; months?: number });
      // Refresh user list
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setUpdating(null);
    }
  }

  const filtered = users.filter(
    (u) =>
      !search ||
      u.email?.toLowerCase().includes(search.toLowerCase()) ||
      u.userId?.toLowerCase().includes(search.toLowerCase())
  );

  const isExpiringSoon = (expires?: string) => {
    if (!expires) return false;
    const diff = new Date(expires).getTime() - Date.now();
    return diff > 0 && diff < 3 * 24 * 60 * 60 * 1000; // < 3 days
  };

  const isExpired = (expires?: string) => {
    if (!expires) return false;
    return new Date(expires).getTime() < Date.now();
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-lg font-semibold text-white">Admin</h1>
          <p className="text-xs text-dim mt-0.5">Panel de gestión SYNTRA</p>
        </div>
        <button
          onClick={load}
          className="text-xs border border-border text-dim hover:text-white px-3 py-1.5 rounded transition-colors"
        >
          ↻ Actualizar
        </button>
      </div>

      {error && (
        <div
          className="px-4 py-3 rounded-lg text-xs"
          style={{
            background: "rgba(255,68,102,0.08)",
            border: "1px solid rgba(255,68,102,0.25)",
            color: "#ff4466",
          }}
        >
          {error}
        </div>
      )}

      {/* Metrics */}
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <MetricCard
            label="MRR Estimado"
            value={`$${metrics.mrr_estimate}`}
            sub="USD / mes"
            color="#00e5a0"
          />
          <MetricCard
            label="Usuarios PRO"
            value={metrics.by_plan.pro}
            sub={`${metrics.by_plan.elite} elite`}
            color="#508cff"
          />
          <MetricCard
            label="Nuevos esta semana"
            value={metrics.new_this_week}
            color="#ffd060"
          />
          <MetricCard
            label="Total usuarios"
            value={metrics.total_users}
            sub={`${metrics.by_plan.free} free`}
          />
        </div>
      )}

      {/* Users table */}
      <Card title={`Usuarios (${filtered.length})`}>
        {/* Search */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Buscar por email o ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-xs bg-surface2 border border-border text-white outline-none focus:border-green placeholder:text-dim transition-colors"
          />
        </div>

        {loading ? (
          <TableSkeleton rows={6} />
        ) : filtered.length === 0 ? (
          <p className="text-xs text-dim text-center py-6">No hay usuarios</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-dim border-b border-border">
                  <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Email</th>
                  <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Plan</th>
                  <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Vence</th>
                  <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Fuente</th>
                  <th className="text-left py-2 font-normal uppercase tracking-wider">Activar</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const expiring = isExpiringSoon(u.plan_expires);
                  const expired  = isExpired(u.plan_expires);

                  return (
                    <tr
                      key={u.userId}
                      className="border-b border-border/40 hover:bg-surface2 transition-colors"
                    >
                      <td className="py-3 pr-3">
                        <p className="text-white font-medium truncate max-w-[180px]">{u.email}</p>
                        <p className="text-dim text-[10px] font-mono">{u.userId?.slice(0, 12)}…</p>
                      </td>

                      <td className="py-3 pr-3">
                        <PlanBadge plan={u.plan || "free"} />
                      </td>

                      <td className="py-3 pr-3">
                        {u.plan_expires ? (
                          <span
                            className={`tabular-nums ${
                              expired
                                ? "text-red"
                                : expiring
                                ? "text-yellow"
                                : "text-dim"
                            }`}
                          >
                            {u.plan_expires.slice(0, 10)}
                            {expiring && " ⚠"}
                            {expired && " ✗"}
                          </span>
                        ) : (
                          <span className="text-dim">—</span>
                        )}
                      </td>

                      <td className="py-3 pr-3">
                        <span className="text-dim capitalize">{u.plan_source || "—"}</span>
                      </td>

                      <td className="py-3">
                        <PlanActivator
                          userId={u.userId}
                          currentPlan={u.plan || "free"}
                          disabled={updating === u.userId}
                          onActivate={(plan, months) => changePlan(u.userId, plan, months)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ── Plan activator inline component ──────────────────────────────────────────
function PlanActivator({
  userId,
  currentPlan,
  disabled,
  onActivate,
}: {
  userId: string;
  currentPlan: string;
  disabled: boolean;
  onActivate: (plan: string, months: number) => void;
}) {
  const [plan, setPlan]     = useState(currentPlan === "free" ? "pro" : currentPlan);
  const [months, setMonths] = useState(1);

  return (
    <div className="flex items-center gap-2">
      <select
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        disabled={disabled}
        className="px-2 py-1 rounded text-xs bg-surface2 border border-border text-white outline-none focus:border-green disabled:opacity-50"
      >
        <option value="free">free</option>
        <option value="pro">pro</option>
        <option value="elite">elite</option>
      </select>

      {plan !== "free" && (
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          disabled={disabled}
          className="px-2 py-1 rounded text-xs bg-surface2 border border-border text-white outline-none focus:border-green disabled:opacity-50"
        >
          {[1, 2, 3, 6, 12].map((m) => (
            <option key={m} value={m}>{m}m</option>
          ))}
        </select>
      )}

      <button
        onClick={() => onActivate(plan, months)}
        disabled={disabled || plan === currentPlan}
        className="px-2.5 py-1 rounded text-xs font-medium transition-all disabled:opacity-30"
        style={{ background: "rgba(0,229,160,0.12)", color: "#00e5a0", border: "1px solid rgba(0,229,160,0.2)" }}
      >
        {disabled ? "…" : "✓"}
      </button>
    </div>
  );
}
