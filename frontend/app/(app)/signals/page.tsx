"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { api, Signal } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";

const POLL_INTERVAL_MS = 30_000;  // 30 seconds

// ── Score bar ────────────────────────────────────────────────────────────────
function ScoreBar({ score, label, color }: { score: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-dim w-20 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-surface2">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: color }}
        />
      </div>
      <span className="text-[10px] tabular-nums w-8 text-right" style={{ color }}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

// ── Signal card ──────────────────────────────────────────────────────────────
function SignalCard({
  signal,
  onResolve,
  resolving,
}: {
  signal: Signal;
  onResolve?: (resultado: "WIN" | "LOSS") => void;
  resolving?: boolean;
}) {
  const [expanded, setExpanded] = useState(signal.status === "open");
  const isOpen = signal.status === "open";

  const dirColor   = signal.direccion === "BUY" ? "#00e5a0" : "#ff4466";
  const scoreColor = (signal.finalScore ?? 0) >= 80
    ? "#00e5a0"
    : (signal.finalScore ?? 0) >= 65
    ? "#ffd060"
    : "#ff4466";

  const stochCells = [
    { tf: "1H", d: signal.stoch1H },
    { tf: "5M", d: signal.stoch5M },
    { tf: "1M", d: signal.stoch1M },
  ];

  return (
    <div
      className="rounded-xl border transition-all"
      style={{
        background:   isOpen ? "rgba(0,229,160,0.03)" : "#0f1520",
        borderColor:  isOpen ? "rgba(0,229,160,0.2)"  : "#1a2035",
        boxShadow:    isOpen ? "0 0 20px rgba(0,229,160,0.06)" : "none",
      }}
    >
      {/* Header row */}
      <button
        className="w-full flex items-center justify-between p-4 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white font-semibold text-sm">
            {signal.indice.replace(/_/g, " ")}
          </span>
          <Badge variant={signal.direccion === "BUY" ? "buy" : "sell"} />
          <Badge
            variant={
              signal.status === "open"
                ? "open"
                : signal.resultado === "WIN"
                ? "win"
                : "loss"
            }
          />
          {signal.scoreFallback && (
            <span className="text-[10px] text-dim border border-border rounded px-1.5 py-0.5">
              fallback
            </span>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 ml-2">
          {signal.finalScore != null && (
            <span
              className="text-xs font-bold tabular-nums"
              style={{ color: scoreColor }}
            >
              {signal.finalScore.toFixed(0)}
            </span>
          )}
          <span className="text-dim text-xs">
            {new Date(signal.createdAt).toLocaleTimeString("es-CR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="text-dim text-xs">{expanded ? "▲" : "▼"}</span>
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Price grid */}
          <div className="grid grid-cols-3 gap-3 text-xs">
            <div className="bg-surface2 border border-border rounded-lg p-3">
              <p className="text-dim mb-1">Entrada</p>
              <p className="text-white tabular-nums font-medium">{signal.entrada?.toFixed(4)}</p>
            </div>
            <div className="bg-surface2 border border-border rounded-lg p-3">
              <p className="text-dim mb-1">Stop Loss</p>
              <p className="text-red tabular-nums font-medium">
                {signal.sl?.toFixed(4)}
                <span className="text-dim ml-1">({signal.slPuntos}pt)</span>
              </p>
            </div>
            <div className="bg-surface2 border border-border rounded-lg p-3">
              <p className="text-dim mb-1">Take Profit</p>
              <p className="text-green tabular-nums font-medium">
                {signal.tp?.toFixed(4)}
                <span className="text-dim ml-1">({signal.tpPuntos}pt)</span>
              </p>
            </div>
          </div>

          {/* Stoch values */}
          <div className="grid grid-cols-3 gap-2">
            {stochCells.map(({ tf, d }) => (
              <div key={tf} className="bg-surface2 border border-border rounded-lg p-2.5 text-center">
                <p className="text-[10px] text-dim uppercase tracking-wide mb-1">{tf}</p>
                {d ? (
                  <>
                    <p className="text-xs tabular-nums font-medium" style={{ color: dirColor }}>
                      K {d.k.toFixed(1)}
                    </p>
                    <p className="text-xs tabular-nums text-dim">
                      D {d.d.toFixed(1)}
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-dim">—</p>
                )}
              </div>
            ))}
          </div>

          {/* Score breakdown */}
          {signal.finalScore != null && (
            <div className="bg-surface2 border border-border rounded-lg p-3 space-y-2">
              <p className="text-[10px] text-dim uppercase tracking-wider mb-2">Score ML</p>
              {signal.sagemakerScore != null && (
                <ScoreBar score={signal.sagemakerScore} label="SageMaker (55%)" color="#508cff" />
              )}
              {signal.bedrockScore != null && (
                <ScoreBar score={signal.bedrockScore} label="Bedrock (25%)" color="#ffd060" />
              )}
              {signal.journalScore != null && (
                <ScoreBar score={signal.journalScore} label="Bitácora (20%)" color="#00e5a0" />
              )}
              <div className="pt-1.5 border-t border-border">
                <ScoreBar score={signal.finalScore} label="SCORE FINAL" color={scoreColor} />
              </div>
              {signal.scoreReason && (
                <p className="text-[10px] text-dim pt-1">{signal.scoreReason}</p>
              )}
            </div>
          )}

          {/* WIN / LOSS buttons for open signals */}
          {isOpen && onResolve && (
            <div className="flex gap-3">
              <button
                onClick={() => onResolve("WIN")}
                disabled={resolving}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                style={{
                  background: "rgba(0,229,160,0.1)",
                  border: "1px solid rgba(0,229,160,0.3)",
                  color: "#00e5a0",
                }}
              >
                {resolving ? "..." : "✓ WIN"}
                {!resolving && (
                  <span className="block text-[10px] font-normal text-dim mt-0.5">
                    +${((signal.tpPuntos ?? 28) * 0.01 * 10).toFixed(2)}
                  </span>
                )}
              </button>
              <button
                onClick={() => onResolve("LOSS")}
                disabled={resolving}
                className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40"
                style={{
                  background: "rgba(255,68,102,0.1)",
                  border: "1px solid rgba(255,68,102,0.3)",
                  color: "#ff4466",
                }}
              >
                {resolving ? "..." : "✗ LOSS"}
                {!resolving && (
                  <span className="block text-[10px] font-normal text-dim mt-0.5">
                    -${((signal.slPuntos ?? 14) * 0.01 * 10).toFixed(2)}
                  </span>
                )}
              </button>
            </div>
          )}

          {/* Closed result */}
          {!isOpen && signal.resultado && (
            <div
              className="text-center py-2 rounded-lg text-sm font-semibold"
              style={{
                background:
                  signal.resultado === "WIN"
                    ? "rgba(0,229,160,0.08)"
                    : "rgba(255,68,102,0.08)",
                color: signal.resultado === "WIN" ? "#00e5a0" : "#ff4466",
              }}
            >
              {signal.resultado === "WIN" ? "✓ WIN" : "✗ LOSS"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Live indicator ────────────────────────────────────────────────────────────
function LiveDot({ active }: { active: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="relative flex h-2.5 w-2.5">
        <span
          className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ background: active ? "#00e5a0" : "#4a5570" }}
        />
        <span
          className="relative inline-flex rounded-full h-2.5 w-2.5"
          style={{ background: active ? "#00e5a0" : "#4a5570" }}
        />
      </div>
      <span className="text-xs" style={{ color: active ? "#00e5a0" : "#4a5570" }}>
        {active ? "LIVE" : "OFFLINE"}
      </span>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function SignalsPage() {
  const [signals, setSignals]   = useState<Signal[]>([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [filter, setFilter]     = useState<"all" | "open" | "closed">("all");
  const [resolving, setResolving] = useState<string | null>(null);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const params: Record<string, string> = {};
      if (filter === "open")   params.status = "open";
      if (filter === "closed") params.status = "win,loss";
      const res = await api.signals.list(params);
      setSignals(res.signals ?? []);
      setLastFetch(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando señales");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [filter]);

  // Initial load + filter changes
  useEffect(() => {
    load(false);
  }, [load]);

  // 30-second polling
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(() => load(true), POLL_INTERVAL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [load]);

  async function handleResolve(signal: Signal, resultado: "WIN" | "LOSS") {
    setResolving(signal.signalId);
    try {
      // Create trade from signal
      await api.trades.create({
        signalId:  signal.signalId,
        indice:    signal.indice,
        direccion: signal.direccion,
        resultado,
        tipo:      "auto",
        fecha:     new Date().toISOString().slice(0, 10),
        entrada:   signal.entrada,
        stoch1H: signal.stoch1H,
        stoch5M: signal.stoch5M,
        stoch1M: signal.stoch1M ?? undefined,
      });
      // Optimistic update
      setSignals((prev) =>
        prev.map((s) =>
          s.signalId === signal.signalId
            ? { ...s, status: "closed" as const, resultado }
            : s
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al registrar resultado");
    } finally {
      setResolving(null);
    }
  }

  const openSignals   = signals.filter((s) => s.status === "open");
  const closedSignals = signals.filter((s) => s.status !== "open");
  const displayed     = filter === "open"
    ? openSignals
    : filter === "closed"
    ? closedSignals
    : signals;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-white">Señales</h1>
            <LiveDot active={!!lastFetch} />
          </div>
          <p className="text-xs text-dim mt-0.5">
            Crash/Boom — Stoch(5,3,3)
            {lastFetch && (
              <span className="ml-2">
                · actualizado{" "}
                {lastFetch.toLocaleTimeString("es-CR", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            )}
          </p>
        </div>

        {/* Filter + Open badge */}
        <div className="flex items-center gap-2">
          {openSignals.length > 0 && (
            <div
              className="px-2.5 py-1 rounded-lg text-xs font-bold animate-pulse"
              style={{ background: "rgba(0,229,160,0.15)", color: "#00e5a0" }}
            >
              {openSignals.length} OPEN
            </div>
          )}
          <div className="flex gap-1">
            {(["all", "open", "closed"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded text-xs transition-all ${
                  filter === f
                    ? "bg-green/10 text-green border border-green/30"
                    : "text-dim border border-border hover:text-white"
                }`}
              >
                {f === "all" ? "Todas" : f === "open" ? "Abiertas" : "Cerradas"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error */}
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

      {/* Content */}
      {loading ? (
        <Card>
          <TableSkeleton rows={4} />
        </Card>
      ) : displayed.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <p className="text-2xl mb-3">📡</p>
            <p className="text-sm text-dim">
              {filter === "open"
                ? "No hay señales abiertas ahora mismo"
                : filter === "closed"
                ? "No hay señales cerradas"
                : "No hay señales disponibles"}
            </p>
            <p className="text-xs text-dim mt-1">
              Las señales se generan cada 5 min (06:00–24:00 CR)
            </p>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayed.map((s) => (
            <SignalCard
              key={s.signalId}
              signal={s}
              onResolve={s.status === "open" ? (r) => handleResolve(s, r) : undefined}
              resolving={resolving === s.signalId}
            />
          ))}
        </div>
      )}

      {/* Polling indicator */}
      <p className="text-center text-[10px] text-dim pb-2">
        Actualización automática cada 30 seg · RR 1:2 · SL 14pt / TP 28pt
      </p>
    </div>
  );
}
