"use client";

import React, { useState, useEffect, useCallback } from "react";
import { api, Signal, Trade, INDEX_CONFIG, IndexValue } from "@/lib/api";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { TableSkeleton } from "@/components/ui/LoadingSkeleton";

type Tab = "pendientes" | "registrar" | "historial";

// ---- Stoch input group ----
function StochRow({
  label,
  k,
  d,
  onK,
  onD,
}: {
  label: string;
  k: string;
  d: string;
  onK: (v: string) => void;
  onD: (v: string) => void;
}) {
  const inputCls =
    "w-full px-2 py-1.5 rounded text-xs bg-surface2 border border-border text-white focus:border-green outline-none tabular-nums";
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-dim w-8 shrink-0">{label}</span>
      <div className="flex-1">
        <label className="text-[10px] text-dim">K</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={k}
          onChange={(e) => onK(e.target.value)}
          className={inputCls}
          placeholder="0–100"
        />
      </div>
      <div className="flex-1">
        <label className="text-[10px] text-dim">D</label>
        <input
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={d}
          onChange={(e) => onD(e.target.value)}
          className={inputCls}
          placeholder="0–100"
        />
      </div>
    </div>
  );
}

// ---- Tab: Pendientes ----
function TabPendientes() {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.signals.list({ status: "open" });
      setSignals(res.signals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando señales");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function resolve(signal: Signal, resultado: "WIN" | "LOSS") {
    setUpdating(signal.signalId);
    try {
      await api.trades.create({
        signalId: signal.signalId,
        indice: signal.indice,
        direccion: signal.direccion,
        resultado,
        tipo: "auto",
        fecha: new Date().toISOString().slice(0, 10),
        entrada: signal.entrada,
        stoch1H: signal.stoch1H,
        stoch5M: signal.stoch5M,
        stoch1M: signal.stoch1M ?? undefined,
      });
      setSignals((prev) => prev.filter((s) => s.signalId !== signal.signalId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setUpdating(null);
    }
  }

  if (loading) return <TableSkeleton rows={3} />;
  if (error) return <p className="text-xs text-red py-4">{error}</p>;
  if (!signals.length)
    return (
      <p className="text-xs text-dim text-center py-8">
        No hay señales abiertas en este momento.
      </p>
    );

  return (
    <div className="space-y-3">
      {signals.map((s) => (
        <div
          key={s.signalId}
          className="bg-surface border border-border rounded-lg p-4"
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-white font-medium text-sm">
                {s.indice.replace(/_/g, " ")}
              </span>
              <Badge variant={s.direccion === "BUY" ? "buy" : "sell"} />
            </div>
            <span className="text-xs text-dim">
              {new Date(s.createdAt).toLocaleString("es-ES")}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3 text-xs">
            <div>
              <span className="text-dim">Entrada</span>
              <p className="text-white tabular-nums">{s.entrada}</p>
            </div>
            <div>
              <span className="text-dim">SL</span>
              <p className="text-red tabular-nums">{s.sl}</p>
            </div>
            <div>
              <span className="text-dim">TP</span>
              <p className="text-green tabular-nums">{s.tp}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
            {[
              { tf: "1H", data: s.stoch1H },
              { tf: "5M", data: s.stoch5M },
              { tf: "1M", data: s.stoch1M },
            ].map(({ tf, data }) => (
              <div key={tf} className="bg-surface2 rounded p-2">
                <p className="text-dim text-[10px] mb-1">{tf}</p>
                <p className="tabular-nums text-white">
                  K: {data?.k?.toFixed(1) ?? "—"} / D: {data?.d?.toFixed(1) ?? "—"}
                </p>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => resolve(s, "WIN")}
              disabled={updating === s.signalId}
              className="flex-1 py-2 rounded text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "rgba(0,229,160,0.15)", color: "#00e5a0", border: "1px solid rgba(0,229,160,0.3)" }}
            >
              {updating === s.signalId ? "..." : "✓ WIN"}
            </button>
            <button
              onClick={() => resolve(s, "LOSS")}
              disabled={updating === s.signalId}
              className="flex-1 py-2 rounded text-xs font-semibold transition-opacity disabled:opacity-50"
              style={{ background: "rgba(255,68,102,0.15)", color: "#ff4466", border: "1px solid rgba(255,68,102,0.3)" }}
            >
              {updating === s.signalId ? "..." : "✗ LOSS"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---- Tab: Registrar ----
function TabRegistrar() {
  const [indice, setIndice] = useState<IndexValue>(INDEX_CONFIG[0].value);
  const [resultado, setResultado] = useState<"WIN" | "LOSS">("WIN");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [hora, setHora] = useState("");
  const [entrada, setEntrada] = useState("");
  const [salida, setSalida] = useState("");
  const [notas, setNotas] = useState("");
  const [tipo, setTipo] = useState<"real" | "backtest" | "auto">("real");
  const [stoch, setStoch] = useState({
    k1H: "", d1H: "",
    k5M: "", d5M: "",
    k1M: "", d1M: "",
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pnlCalc =
    entrada && salida
      ? parseFloat(salida) - parseFloat(entrada)
      : null;

  const inputCls =
    "w-full px-3 py-2 rounded text-sm bg-surface2 border border-border text-white focus:border-green outline-none";
  const labelCls = "block text-xs text-dim mb-1";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.trades.create({
        indice,
        resultado,
        fecha,
        hora: hora || undefined,
        entrada: entrada ? parseFloat(entrada) : undefined,
        salida: salida ? parseFloat(salida) : undefined,
        pnl: pnlCalc ?? undefined,
        notas: notas || undefined,
        tipo,
        stoch1H:
          stoch.k1H && stoch.d1H
            ? { k: parseFloat(stoch.k1H), d: parseFloat(stoch.d1H) }
            : undefined,
        stoch5M:
          stoch.k5M && stoch.d5M
            ? { k: parseFloat(stoch.k5M), d: parseFloat(stoch.d5M) }
            : undefined,
        stoch1M:
          stoch.k1M && stoch.d1M
            ? { k: parseFloat(stoch.k1M), d: parseFloat(stoch.d1M) }
            : undefined,
      });
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
      // Reset form
      setEntrada(""); setSalida(""); setNotas(""); setHora("");
      setStoch({ k1H: "", d1H: "", k5M: "", d5M: "", k1M: "", d1M: "" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-xl">
      {success && (
        <div className="px-3 py-2 rounded text-xs" style={{ background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.3)", color: "#00e5a0" }}>
          Operación registrada correctamente
        </div>
      )}
      {error && (
        <div className="px-3 py-2 rounded text-xs" style={{ background: "rgba(255,68,102,0.1)", border: "1px solid rgba(255,68,102,0.3)", color: "#ff4466" }}>
          {error}
        </div>
      )}

      {/* Índice */}
      <div>
        <label className={labelCls}>ÍNDICE</label>
        <select
          value={indice}
          onChange={(e) => setIndice(e.target.value as IndexValue)}
          className={inputCls}
        >
          {INDEX_CONFIG.map((idx) => (
            <option key={idx.value} value={idx.value}>
              {idx.label}
            </option>
          ))}
        </select>
      </div>

      {/* Resultado toggle */}
      <div>
        <label className={labelCls}>RESULTADO</label>
        <div className="flex gap-2">
          {(["WIN", "LOSS"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setResultado(r)}
              className="flex-1 py-2 rounded text-xs font-semibold transition-all"
              style={{
                background:
                  resultado === r
                    ? r === "WIN"
                      ? "rgba(0,229,160,0.2)"
                      : "rgba(255,68,102,0.2)"
                    : "#141c2e",
                border:
                  resultado === r
                    ? r === "WIN"
                      ? "1px solid rgba(0,229,160,0.5)"
                      : "1px solid rgba(255,68,102,0.5)"
                    : "1px solid #1a2035",
                color:
                  resultado === r
                    ? r === "WIN"
                      ? "#00e5a0"
                      : "#ff4466"
                    : "#4a5570",
              }}
            >
              {r === "WIN" ? "✓ WIN" : "✗ LOSS"}
            </button>
          ))}
        </div>
      </div>

      {/* Fecha / Hora */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>FECHA</label>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>HORA</label>
          <input
            type="time"
            value={hora}
            onChange={(e) => setHora(e.target.value)}
            className={inputCls}
          />
        </div>
      </div>

      {/* Entrada / Salida */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>ENTRADA</label>
          <input
            type="number"
            step="0.00001"
            value={entrada}
            onChange={(e) => setEntrada(e.target.value)}
            placeholder="0.00000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>SALIDA</label>
          <input
            type="number"
            step="0.00001"
            value={salida}
            onChange={(e) => setSalida(e.target.value)}
            placeholder="0.00000"
            className={inputCls}
          />
        </div>
      </div>

      {/* P&L calculado */}
      {pnlCalc !== null && (
        <div className="px-3 py-2 rounded text-xs flex items-center justify-between bg-surface2">
          <span className="text-dim">P&L Calculado</span>
          <span className={pnlCalc >= 0 ? "text-green" : "text-red"}>
            {pnlCalc >= 0 ? "+" : ""}${pnlCalc.toFixed(2)}
          </span>
        </div>
      )}

      {/* Stoch */}
      <div>
        <label className={labelCls + " mb-2"}>STOCHASTIC</label>
        <div className="space-y-2">
          <StochRow
            label="1H"
            k={stoch.k1H}
            d={stoch.d1H}
            onK={(v) => setStoch((s) => ({ ...s, k1H: v }))}
            onD={(v) => setStoch((s) => ({ ...s, d1H: v }))}
          />
          <StochRow
            label="5M"
            k={stoch.k5M}
            d={stoch.d5M}
            onK={(v) => setStoch((s) => ({ ...s, k5M: v }))}
            onD={(v) => setStoch((s) => ({ ...s, d5M: v }))}
          />
          <StochRow
            label="1M"
            k={stoch.k1M}
            d={stoch.d1M}
            onK={(v) => setStoch((s) => ({ ...s, k1M: v }))}
            onD={(v) => setStoch((s) => ({ ...s, d1M: v }))}
          />
        </div>
      </div>

      {/* Tipo */}
      <div>
        <label className={labelCls}>TIPO</label>
        <div className="flex gap-2">
          {(["real", "backtest", "auto"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTipo(t)}
              className="px-3 py-1.5 rounded text-xs transition-all capitalize"
              style={{
                background: tipo === t ? "#141c2e" : "transparent",
                border: tipo === t ? "1px solid #508cff" : "1px solid #1a2035",
                color: tipo === t ? "#508cff" : "#4a5570",
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Notas */}
      <div>
        <label className={labelCls}>NOTAS</label>
        <textarea
          value={notas}
          onChange={(e) => setNotas(e.target.value)}
          rows={3}
          placeholder="Observaciones de la operación..."
          className={inputCls + " resize-none"}
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded text-sm font-semibold transition-opacity disabled:opacity-50"
        style={{ background: "#00e5a0", color: "#0a0d14" }}
      >
        {loading ? "Guardando..." : "Registrar Operación"}
      </button>
    </form>
  );
}

// ---- Tab: Historial ----
function TabHistorial() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    indice: "",
    resultado: "",
    tipo: "",
    desde: "",
    hasta: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filters.indice) params.indice = filters.indice;
      if (filters.resultado) params.resultado = filters.resultado;
      if (filters.tipo) params.tipo = filters.tipo;
      if (filters.desde) params.desde = filters.desde;
      if (filters.hasta) params.hasta = filters.hasta;

      const res = await api.trades.list(params);
      setTrades(res.trades ?? []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { load(); }, [load]);

  const wins = trades.filter((t) => t.resultado === "WIN").length;
  const losses = trades.filter((t) => t.resultado === "LOSS").length;
  const total = wins + losses;
  const winRate = total > 0 ? ((wins / total) * 100).toFixed(1) : "—";
  const pnlSum = trades.reduce((acc, t) => acc + (t.pnl ?? 0), 0);

  const selectCls =
    "px-2 py-1.5 rounded text-xs bg-surface2 border border-border text-white focus:border-green outline-none";

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={filters.indice}
          onChange={(e) => setFilters((f) => ({ ...f, indice: e.target.value }))}
          className={selectCls}
        >
          <option value="">Todos los índices</option>
          {INDEX_CONFIG.map((idx) => (
            <option key={idx.value} value={idx.value}>
              {idx.label}
            </option>
          ))}
        </select>

        <select
          value={filters.resultado}
          onChange={(e) => setFilters((f) => ({ ...f, resultado: e.target.value }))}
          className={selectCls}
        >
          <option value="">WIN / LOSS</option>
          <option value="WIN">WIN</option>
          <option value="LOSS">LOSS</option>
        </select>

        <select
          value={filters.tipo}
          onChange={(e) => setFilters((f) => ({ ...f, tipo: e.target.value }))}
          className={selectCls}
        >
          <option value="">Todos los tipos</option>
          <option value="real">Real</option>
          <option value="backtest">Backtest</option>
          <option value="auto">Auto</option>
        </select>

        <input
          type="date"
          value={filters.desde}
          onChange={(e) => setFilters((f) => ({ ...f, desde: e.target.value }))}
          className={selectCls}
          placeholder="Desde"
        />
        <input
          type="date"
          value={filters.hasta}
          onChange={(e) => setFilters((f) => ({ ...f, hasta: e.target.value }))}
          className={selectCls}
          placeholder="Hasta"
        />
      </div>

      {/* Table */}
      {loading ? (
        <TableSkeleton rows={6} />
      ) : trades.length === 0 ? (
        <p className="text-xs text-dim text-center py-8">
          No se encontraron operaciones con esos filtros.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-dim border-b border-border">
                <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Fecha</th>
                <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Índice</th>
                <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Dir</th>
                <th className="text-center py-2 pr-3 font-normal uppercase tracking-wider">1H K/D</th>
                <th className="text-left py-2 pr-3 font-normal uppercase tracking-wider">Resultado</th>
                <th className="text-right py-2 font-normal uppercase tracking-wider">P&L</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.tradeId} className="border-b border-border/50 hover:bg-surface2 transition-colors">
                  <td className="py-2.5 pr-3 text-dim">{t.fecha}</td>
                  <td className="py-2.5 pr-3 text-white font-medium">{t.indice.replace(/_/g, " ")}</td>
                  <td className="py-2.5 pr-3">
                    <Badge variant={t.direccion === "BUY" ? "buy" : "sell"} />
                  </td>
                  <td className="py-2.5 pr-3 text-center tabular-nums text-dim">
                    {t.stoch1H
                      ? `${t.stoch1H.k.toFixed(0)}/${t.stoch1H.d.toFixed(0)}`
                      : "—"}
                  </td>
                  <td className="py-2.5 pr-3">
                    <Badge variant={t.resultado === "WIN" ? "win" : t.resultado === "LOSS" ? "loss" : "open"} />
                  </td>
                  <td className={`py-2.5 text-right tabular-nums font-medium ${(t.pnl ?? 0) >= 0 ? "text-green" : "text-red"}`}>
                    {t.pnl !== undefined ? `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totals row */}
            <tfoot>
              <tr className="border-t-2 text-dim" style={{ borderColor: "#1a2035" }}>
                <td colSpan={2} className="py-2.5 text-xs font-medium text-white">
                  {trades.length} operaciones
                </td>
                <td colSpan={2} className="py-2.5 text-center text-xs">
                  {winRate}% WR
                </td>
                <td className="py-2.5 text-xs">{wins}W / {losses}L</td>
                <td className={`py-2.5 text-right tabular-nums text-xs font-semibold ${pnlSum >= 0 ? "text-green" : "text-red"}`}>
                  {pnlSum >= 0 ? "+" : ""}${pnlSum.toFixed(2)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Main Journal Page ----
export default function JournalPage() {
  const [tab, setTab] = useState<Tab>("pendientes");

  const tabs: { id: Tab; label: string }[] = [
    { id: "pendientes", label: "Pendientes" },
    { id: "registrar", label: "Registrar" },
    { id: "historial", label: "Historial" },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-white">Bitácora</h1>
        <p className="text-xs text-dim mt-0.5">Gestión de operaciones y señales</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-xs font-medium transition-colors border-b-2 -mb-px ${
              tab === t.id
                ? "text-green border-green"
                : "text-dim border-transparent hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <Card>
        {tab === "pendientes" && <TabPendientes />}
        {tab === "registrar" && <TabRegistrar />}
        {tab === "historial" && <TabHistorial />}
      </Card>
    </div>
  );
}
