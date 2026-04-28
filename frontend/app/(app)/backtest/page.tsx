"use client";

import React, { useState } from "react";
import { Card } from "@/components/ui/Card";
import { api, BacktestResult, INDEX_CONFIG } from "@/lib/api";

// ── Mini equity chart (pure SVG, no deps) ────────────────────────────────────
function EquityChart({ points }: { points: { cumulative: number }[] }) {
  if (!points.length) return null;
  const W = 520, H = 120, PAD = 10;
  const vals = points.map((p) => p.cumulative);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const range = max - min || 1;
  const xs = points.map((_, i) => PAD + (i / Math.max(points.length - 1, 1)) * (W - PAD * 2));
  const ys = vals.map((v) => H - PAD - ((v - min) / range) * (H - PAD * 2));
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const fillPath = `${path} L${xs[xs.length - 1].toFixed(1)},${(H - PAD).toFixed(1)} L${xs[0].toFixed(1)},${(H - PAD).toFixed(1)} Z`;
  const zeroY = H - PAD - ((0 - min) / range) * (H - PAD * 2);
  const isPositive = vals[vals.length - 1] >= 0;
  const color = isPositive ? "#00e5a0" : "#f87171";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-24" preserveAspectRatio="none">
      <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY} stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
      <path d={fillPath} fill={color} fillOpacity="0.08" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] text-dim uppercase tracking-wide">{label}</span>
      <span className="text-lg font-semibold text-white">{value}</span>
      {sub && <span className="text-[10px] text-dim">{sub}</span>}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BacktestPage() {
  const [symbol, setSymbol]         = useState("CRASH500");
  const [candleCount, setCandleCount] = useState(200);
  const [slPoints, setSlPoints]     = useState(14);
  const [tpPoints, setTpPoints]     = useState(28);
  const [require1m, setRequire1m]   = useState(false);
  const [loading, setLoading]       = useState(false);
  const [result, setResult]         = useState<BacktestResult | null>(null);
  const [error, setError]           = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.backtest.run({
        symbol,
        candleCount: String(candleCount),
        slPoints: String(slPoints),
        tpPoints: String(tpPoints),
        require1m: String(require1m),
      });
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  }

  const isCrash = symbol.toUpperCase().startsWith("CRASH");
  const dirLabel = isCrash ? "SELL" : "BUY";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-lg font-semibold text-white">Backtesting</h1>
        <p className="text-xs text-dim mt-0.5">
          Stoch (5,3,3) — estrategia {dirLabel} sobre datos históricos de Deriv
        </p>
      </div>

      {/* Config form */}
      <Card>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {/* Symbol */}
          <div className="flex flex-col gap-1 col-span-2 sm:col-span-1">
            <label className="text-[10px] text-dim uppercase tracking-wide">Índice</label>
            <select
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              className="bg-transparent border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30"
            >
              {INDEX_CONFIG.map((c) => (
                <option key={c.value} value={c.value} style={{ background: "#0d1117" }}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          {/* Candle count */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-dim uppercase tracking-wide">Velas 1H</label>
            <input
              type="number"
              min={20}
              max={500}
              value={candleCount}
              onChange={(e) => setCandleCount(Number(e.target.value))}
              className="bg-transparent border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* SL */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-dim uppercase tracking-wide">SL (pts)</label>
            <input
              type="number"
              min={1}
              value={slPoints}
              onChange={(e) => setSlPoints(Number(e.target.value))}
              className="bg-transparent border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* TP */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-dim uppercase tracking-wide">TP (pts)</label>
            <input
              type="number"
              min={1}
              value={tpPoints}
              onChange={(e) => setTpPoints(Number(e.target.value))}
              className="bg-transparent border border-white/10 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-white/30 w-full"
            />
          </div>

          {/* Require 1M */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] text-dim uppercase tracking-wide">Confirmar 1M</label>
            <div className="flex items-center h-8">
              <button
                onClick={() => setRequire1m((v) => !v)}
                className={`w-10 h-5 rounded-full transition-colors relative ${require1m ? "bg-teal-500" : "bg-white/10"}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${require1m ? "translate-x-5" : ""}`}
                />
              </button>
              <span className="ml-2 text-xs text-dim">{require1m ? "Sí" : "No"}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="px-5 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
            style={{ background: "rgba(0,229,160,0.15)", border: "1px solid rgba(0,229,160,0.3)", color: "#00e5a0" }}
          >
            {loading ? "Calculando…" : "▶ Ejecutar backtest"}
          </button>
          {result && (
            <span className="text-xs text-dim">
              {result.candleCount} velas · últimas ~{Math.round(result.candleCount / 24)} días
            </span>
          )}
        </div>
      </Card>

      {/* Error */}
      {error && (
        <Card>
          <p className="text-sm text-red-400">⚠️ {error}</p>
        </Card>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Card>
              <Stat
                label="Win Rate"
                value={`${result.stats.winRate}%`}
                sub={`${result.stats.wins}W / ${result.stats.losses}L`}
              />
            </Card>
            <Card>
              <Stat
                label="P&L Total"
                value={`${result.stats.pnlTotal >= 0 ? "+" : ""}${result.stats.pnlTotal} pts`}
                sub={`Avg ${result.stats.pnlAvg >= 0 ? "+" : ""}${result.stats.pnlAvg} pts/op`}
              />
            </Card>
            <Card>
              <Stat
                label="Operaciones"
                value={result.stats.total}
                sub={`Promedio ${result.stats.avgBars} velas`}
              />
            </Card>
            <Card>
              <Stat
                label="RR Ratio"
                value={`1 : ${(tpPoints / slPoints).toFixed(1)}`}
                sub={`SL ${slPoints} pts / TP ${tpPoints} pts`}
              />
            </Card>
          </div>

          {/* Equity curve */}
          {result.equity.length > 1 && (
            <Card>
              <p className="text-[10px] text-dim uppercase tracking-wide mb-2">Curva de capital (puntos acumulados)</p>
              <EquityChart points={result.equity} />
              <div className="flex justify-between mt-1">
                <span className="text-[10px] text-dim">inicio</span>
                <span
                  className="text-[10px] font-medium"
                  style={{ color: result.stats.pnlTotal >= 0 ? "#00e5a0" : "#f87171" }}
                >
                  {result.stats.pnlTotal >= 0 ? "+" : ""}{result.stats.pnlTotal} pts
                </span>
              </div>
            </Card>
          )}

          {/* Trades table */}
          {result.trades.length > 0 ? (
            <Card>
              <p className="text-[10px] text-dim uppercase tracking-wide mb-3">
                Operaciones simuladas ({result.trades.length})
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-dim border-b border-white/5">
                      <th className="text-left pb-2 font-normal">#</th>
                      <th className="text-left pb-2 font-normal">Fecha</th>
                      <th className="text-right pb-2 font-normal">Entrada</th>
                      <th className="text-right pb-2 font-normal">SL</th>
                      <th className="text-right pb-2 font-normal">TP</th>
                      <th className="text-center pb-2 font-normal">Resultado</th>
                      <th className="text-right pb-2 font-normal">Velas</th>
                      <th className="text-right pb-2 font-normal">P&L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => {
                      const date = new Date(t.epoch * 1000).toLocaleDateString("es-CR", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                        timeZone: "America/Costa_Rica",
                      });
                      return (
                        <tr key={i} className="border-b border-white/5 last:border-0">
                          <td className="py-1.5 text-dim">{i + 1}</td>
                          <td className="py-1.5 text-dim">{date}</td>
                          <td className="py-1.5 text-right font-mono">{t.entry}</td>
                          <td className="py-1.5 text-right font-mono text-red-400">{t.sl}</td>
                          <td className="py-1.5 text-right font-mono text-teal-400">{t.tp}</td>
                          <td className="py-1.5 text-center">
                            <span
                              className="px-2 py-0.5 rounded text-[10px] font-medium"
                              style={{
                                background: t.result === "WIN" ? "rgba(0,229,160,0.1)" : "rgba(248,113,113,0.1)",
                                color: t.result === "WIN" ? "#00e5a0" : "#f87171",
                                border: `1px solid ${t.result === "WIN" ? "rgba(0,229,160,0.2)" : "rgba(248,113,113,0.2)"}`,
                              }}
                            >
                              {t.result}
                            </span>
                          </td>
                          <td className="py-1.5 text-right text-dim">{t.bars}</td>
                          <td
                            className="py-1.5 text-right font-mono font-medium"
                            style={{ color: t.pnl >= 0 ? "#00e5a0" : "#f87171" }}
                          >
                            {t.pnl >= 0 ? "+" : ""}{t.pnl}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-dim text-center py-4">
                No se encontraron señales en este período con los parámetros seleccionados.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
