"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { api } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface ChatContext {
  winRate?: number;
  pnlWeek?: number;
  rachaNeg?: boolean;
  totalTrades?: number;
}

// ── Message bubble ────────────────────────────────────────────────────────────
function Bubble({ msg }: { msg: Message }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className="max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
        style={
          isUser
            ? {
                background: "rgba(0,229,160,0.12)",
                border: "1px solid rgba(0,229,160,0.2)",
                color: "#e2e8f0",
              }
            : {
                background: "#0f1520",
                border: "1px solid #1a2035",
                color: "#e2e8f0",
              }
        }
      >
        {!isUser && (
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-xs font-semibold" style={{ color: "#00e5a0" }}>
              ◉ SYNTRA Copiloto
            </span>
          </div>
        )}
        <p className="whitespace-pre-wrap">{msg.content}</p>
        <p className="text-[10px] text-dim mt-1.5 text-right">
          {msg.timestamp.toLocaleTimeString("es-CR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}

// ── Typing indicator ──────────────────────────────────────────────────────────
function TypingIndicator() {
  return (
    <div className="flex justify-start">
      <div
        className="rounded-2xl px-4 py-3"
        style={{ background: "#0f1520", border: "1px solid #1a2035" }}
      >
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 rounded-full"
              style={{
                background: "#4a5570",
                animation: `bounce 1.2s infinite`,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Suggestion chip ───────────────────────────────────────────────────────────
function Chip({
  text,
  onClick,
  disabled,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="px-3 py-1.5 rounded-full text-xs border transition-all disabled:opacity-40 text-left"
      style={{ borderColor: "#1a2035", color: "#4a5570" }}
      onMouseEnter={(e) => {
        if (!disabled) {
          (e.target as HTMLElement).style.borderColor = "#00e5a0";
          (e.target as HTMLElement).style.color = "#00e5a0";
        }
      }}
      onMouseLeave={(e) => {
        (e.target as HTMLElement).style.borderColor = "#1a2035";
        (e.target as HTMLElement).style.color = "#4a5570";
      }}
    >
      {text}
    </button>
  );
}

// ── Context strip ─────────────────────────────────────────────────────────────
function ContextStrip({ ctx }: { ctx: ChatContext }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-2 text-xs overflow-x-auto"
      style={{ borderBottom: "1px solid #1a2035", background: "#0a0d14" }}
    >
      <span className="text-dim shrink-0">Esta semana:</span>
      <span className="tabular-nums shrink-0" style={{ color: (ctx.pnlWeek ?? 0) >= 0 ? "#00e5a0" : "#ff4466" }}>
        {(ctx.pnlWeek ?? 0) >= 0 ? "+" : ""}${ctx.pnlWeek?.toFixed(2) ?? "—"}
      </span>
      <span className="text-dim shrink-0">WR:</span>
      <span
        className="tabular-nums shrink-0"
        style={{ color: (ctx.winRate ?? 0) >= 50 ? "#00e5a0" : "#ff4466" }}
      >
        {ctx.winRate ?? "—"}%
      </span>
      <span className="text-dim shrink-0">Trades:</span>
      <span className="tabular-nums shrink-0 text-white">{ctx.totalTrades ?? "—"}</span>
      {ctx.rachaNeg && (
        <span
          className="shrink-0 px-2 py-0.5 rounded text-[10px] font-medium"
          style={{ background: "rgba(255,68,102,0.15)", color: "#ff4466" }}
        >
          ⚠ RACHA NEG
        </span>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function CopilotPage() {
  const [messages, setMessages]     = useState<Message[]>([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [context, setContext]       = useState<ChatContext>({});
  const [error, setError]           = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  // Load suggestions on mount
  useEffect(() => {
    api.copilot.suggestions().then((res) => {
      setSuggestions(res.suggestions ?? []);
    }).catch(() => {});
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      role: "user",
      content: text.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setError(null);

    // Build history for Bedrock (last 10 turns)
    const history = messages.slice(-10).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const res = await api.copilot.chat({ message: text.trim(), history });

      const assistantMsg: Message = {
        role: "assistant",
        content: res.reply,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMsg]);

      // Update context strip
      if (res.context) setContext(res.context);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al conectar con el Copiloto");
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [loading, messages]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  const showSuggestions = messages.length === 0 && !loading;

  return (
    <div
      className="flex flex-col"
      style={{ height: "calc(100vh - 64px)" }}
    >
      {/* Header */}
      <div
        className="px-4 py-3 flex items-center gap-3"
        style={{ borderBottom: "1px solid #1a2035" }}
      >
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{ background: "rgba(0,229,160,0.15)", color: "#00e5a0" }}
        >
          ◉
        </div>
        <div>
          <p className="text-sm font-semibold text-white">SYNTRA Copiloto</p>
          <p className="text-[10px] text-dim">Impulsado por claude-sonnet-4-5</p>
        </div>
      </div>

      {/* Context strip (shows after first message) */}
      {Object.keys(context).length > 0 && <ContextStrip ctx={context} />}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {/* Welcome */}
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div
              className="w-14 h-14 rounded-full flex items-center justify-center text-2xl mx-auto mb-4"
              style={{ background: "rgba(0,229,160,0.08)", border: "1px solid rgba(0,229,160,0.15)" }}
            >
              ◉
            </div>
            <p className="text-sm text-white font-medium mb-1">Hola, soy tu Copiloto</p>
            <p className="text-xs text-dim">
              Analizo tu historial y te doy recomendaciones personalizadas.
            </p>
          </div>
        )}

        {/* Suggestion chips */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-center pt-2">
            {suggestions.map((s) => (
              <Chip
                key={s}
                text={s}
                onClick={() => sendMessage(s)}
                disabled={loading}
              />
            ))}
          </div>
        )}

        {/* Chat bubbles */}
        {messages.map((msg, i) => (
          <Bubble key={i} msg={msg} />
        ))}

        {/* Typing indicator */}
        {loading && <TypingIndicator />}

        {/* Error */}
        {error && (
          <div
            className="text-xs px-4 py-2 rounded-lg text-center"
            style={{
              background: "rgba(255,68,102,0.08)",
              border: "1px solid rgba(255,68,102,0.2)",
              color: "#ff4466",
            }}
          >
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div
        className="px-4 py-3"
        style={{ borderTop: "1px solid #1a2035", background: "#0a0d14" }}
      >
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: "#0f1520", border: "1px solid #1a2035" }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            placeholder="Pregúntame algo sobre tu trading…"
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-dim outline-none resize-none leading-relaxed"
            style={{ maxHeight: "120px" }}
            onInput={(e) => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={loading || !input.trim()}
            className="shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-all disabled:opacity-30"
            style={{ background: "#00e5a0", color: "#0a0d14" }}
          >
            {loading ? (
              <span className="text-xs">…</span>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </div>
        <p className="text-[10px] text-dim text-center mt-2">
          Enter para enviar · Shift+Enter para nueva línea
        </p>
      </div>

      <style>{`
        @keyframes bounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-4px); }
        }
      `}</style>
    </div>
  );
}
