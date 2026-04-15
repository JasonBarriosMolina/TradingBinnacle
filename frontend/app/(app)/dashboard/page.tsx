"use client";

import React, { useEffect, useState } from "react";
import { api, StatsSummary, EquityPoint, Trade } from "@/lib/api";
import { StatCard } from "@/components/ui/StatCard";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { CardSkeleton, TableSkeleton } from "@/components/ui/LoadingSkeleton";

// ---- Equity Curve SVG ----
function EquityCurve({ points }: { points: EquityPoint[] }) {
  if (!points.length) {
    return (
      <div className="h-40 flex items-center justify-center text-dim text-xs">
        Sin datos de equity
      </div>
    );
  }

  const W = 600;
  const H = 140;
  const PAD_LEFT = 52;
  const PAD_RIGHT = 12;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 28;
  const innerW = W - PAD_LEFT - PAD_RIGHT;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  const last14 = points.slice(-14);
  const cumValues = last14.map((p) => p.cumulative);
  const minVal = Math.min(...cumValues);
  const maxVal = Math.max(...cumValues);
  const range = maxVal - minVal || 1;

  const barW = innerW / last14.length - 2;

  const toY = (v: number) =>
    PAD_TOP + innerH - ((v - minVal) / range) * innerH;

  // Polyline for running total
  const linePoints = last14
    .map((p, i) => {
      const x = PAD_LEFT + (i / (last14.length - 1)) * innerW;
      const y = toY(p.cumulative);
      return `${x},${y}`;
    })
    .join(" ");

  // Y axis labels
  const yLabels = [minVal, (minVal + maxVal) / 2, maxVal];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="w-full"
      style={{ maxHeight: "160px" }}
    >
      {/* Grid lines */}
      {yLabels.map((v, i) => {
        const y = toY(v);
        return (
          <g key={i}>
            <line
              x1={PAD_LEFT}
              y1={y}
              x2={W - PAD_RIGHT}
              y2={y}
              stroke="#1a2035"
              strokeWidth="1"
            />
            <text
              x={PAD_LEFT - 4}
              y={y + 4}
              textAnchor="end"
              fontSize="9"
              fill="#4a5570"
            >
              {v >= 0 ? `+${v.toFixed(0)}` : v.toFixed(0)}
            </text>
          </g>
        );
      })}

      {/* Bars */}
      {last14.map((p, i) => {
        const x = PAD_LEFT + i * (innerW / last14.length) + 1;
        const positive = p.pnl >= 0;
        const baseY = toY(0);
        const valY = toY(Math.abs(p.pnl) * (positive ? 1 : -1) + (positive ? 0 : 0));
        const barH = Math.abs(toY(0) - valY) || 2;
        const barY = positive ? Math.min(baseY, valY) : baseY;

        return (
          <rect
            key={i}
            x={x}
            y={barY}
            width={barW}
            height={barH}
            fill={positive ? "rgba(0,229,160,0.55)" : "rgba(255,68,102,0.55)"}
            rx="1"
          />
        );
      })}

      {/* Running total line */}
      {last14.length > 1 && (
        <polyline
          points={linePoints}
          fill="none"
          stroke="#00e5a0"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      )}

      {/* X axis date labels */}
      {last14.map((p, i) => {
        if (i % 3 !== 0 && i !== last14.length - 1) return null;
        const x = PAD_LEFT + (i / (last14.length - 1)) * innerW;
        const label = p.fecha.slice(5); // MM-DD
        return (
          <text
            key={i}
            x={x}
            y={H - 4}
            textAnchor="middle"
            fontSize="9"
            fill="#4a5570"
          >
            {label}
          </text>
        );
      })}
    </svg>
  );
}

// ---- Dashboard Page ----
export default function DashboardPage() {
  const [stats, setStats] = useState<StatsSummary | null>(null);
  const [equity, setEquity] = useState<EquityPoint[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const [statsRes, equityRes, tradesRes] = await Promise.all([
          api.stats.summary(),
          api.stats.equity(),
          api.trades.list({ limit: 5 }),
        ]);
        setStats(statsRes);
        setEquity(equityRes.points ?? []);
        setRecentTrades(tradesRes.trades ?? []);
      } catch (err) {
        console.error("Dashboard load error", err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const winRatePositive = (stats?.winRate ?? 0) >= 50;
  const pnlPositive = (stats?.pnlWeek ?? 0) >= 0;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">Dashboard</h1>
          <p className="text-xs text-dim mt-0.5">
            {new Date().toLocaleDateString("es-ES", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
      </div>

      {/* Alert: negative streak */}
      {stats?.rachaNegativa && (
        <div
          className="px-4 py-3 rounded-lg text-sm flex items-center gap-2"
          style={{
            background: "rgba(255,68,102,0.08)",
            border: "1px solid rgba(255,68,102,0.25)",
            color: "#ff4466",
          }}
        >
          <span>⚠</span>
          <span>
            Racha de 3 pérdidas — considera pausar y revisar tu estrategia
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Win Rate"
              value={`${stats?.winRate?.toFixed(1) ?? "—"}%`}
              positive={winRatePositive}
              trend={winRatePositive ? "up" : "down"}
              subtext={`${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`}
            />
            <StatCard
              label="P&L Semana"
              value={`${(stats?.pnlWeek ?? 0) >= 0 ? "+" : ""}$${stats?.pnlWeek?.toFixed(2) ?? "—"}`}
              positive={pnlPositive}
              trend={pnlPositive ? "up" : "down"}
            />
            <StatCard
              label="Capital Actual"
              value={`$${stats?.capital?.toFixed(2) ?? "—"}`}
            />
            <StatCard
              label="R:R Promedio"
              value={stats?.rrPromedio?.toFixed(2) ?? "—"}
              subtext="ratio riesgo/beneficio"
            />
          </>
        )}
      </div>

      {/* Lotaje indicator */}
      {stats && (
        <div
          className="px-4 py-2.5 rounded-lg text-xs flex items-center gap-2"
          style={{
            background: "#141c2e",
            border: "1px solid #1a2035",
            color: "#4a5570",
          }}
        >
          <span style={{ color: "#ffd060" }}>◈</span>
          <span>
            Lotaje actual:{" "}
            <span className="text-white font-medium">
              {stats.lotajeSugerido ?? "0.01"}
            </span>{" "}
            — Sube a 0.25 cuando llegues a{" "}
            <span className="text-white">$200</span>
          </span>
        </div>
      )}

      {/* Equity curve */}
      <Card title="Equity — Últimos 14 días">
        {loading ? (
          <div className="h-40 bg-surface2 rounded skeleton-pulse" />
        ) : (
          <EquityCurve points={equity} />
        )}
      </Card>

      {/* Recent trades table */}
      <Card title="Últimas Operaciones">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : recentTrades.length === 0 ? (
          <p className="text-xs text-dim text-center py-6">
            No hay operaciones registradas aún.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-dim border-b border-border">
                  <th className="text-left py-2 pr-4 font-normal uppercase tracking-wider">
                    Índice
                  </th>
                  <th className="text-left py-2 pr-4 font-normal uppercase tracking-wider">
                    Dirección
                  </th>
                  <th className="text-left py-2 pr-4 font-normal uppercase tracking-wider">
                    Resultado
                  </th>
                  <th className="text-right py-2 font-normal uppercase tracking-wider">
                    P&L
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t) => (
                  <tr
                    key={t.tradeId}
                    className="border-b border-border/50 hover:bg-surface2 transition-colors"
                  >
                    <td className="py-2.5 pr-4 font-medium text-white">
                      {t.indice.replace(/_/g, " ")}
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge
                        variant={
                          t.direccion === "BUY" ? "buy" : "sell"
                        }
                      />
                    </td>
                    <td className="py-2.5 pr-4">
                      <Badge
                        variant={
                          t.resultado === "WIN"
                            ? "win"
                            : t.resultado === "LOSS"
                            ? "loss"
                            : "open"
                        }
                      />
                    </td>
                    <td
                      className={`py-2.5 text-right tabular-nums font-medium ${
                        (t.pnl ?? 0) >= 0 ? "text-green" : "text-red"
                      }`}
                    >
                      {t.pnl !== undefined
                        ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
