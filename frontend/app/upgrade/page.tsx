"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";

const WHATSAPP_NUMBER = process.env.NEXT_PUBLIC_WHATSAPP_NUMBER || "50600000000";

const PLANS = [
  {
    id: "free",
    name: "FREE",
    price: "$0",
    period: "",
    color: "#4a5570",
    features: [
      "Bitácora manual ilimitada",
      "Últimas 10 señales (sin score ML)",
      "Stats básicos",
      "Backtesting",
    ],
    missing: ["Señales live en tiempo real", "Score ML", "Telegram Bot", "Copiloto IA", "Reporte semanal"],
  },
  {
    id: "pro",
    name: "PRO",
    price: "$9",
    period: "/mes",
    color: "#508cff",
    popular: true,
    features: [
      "Señales live en tiempo real",
      "Score ML completo (SageMaker + Bedrock)",
      "Telegram Bot",
      "Copiloto IA",
      "Reporte semanal automático",
      "ML Insights completo",
      "Alertas de racha negativa",
      "Bitácora ilimitada",
    ],
    missing: [],
  },
  {
    id: "elite",
    name: "ELITE",
    price: "$19",
    period: "/mes",
    color: "#ffd060",
    features: [
      "Todo lo de PRO",
      "Todos los índices sin límite",
      "Proyección de capital (Forecast)",
      "Paper trading mode",
      "Score mínimo configurable",
      "Soporte WhatsApp directo",
    ],
    missing: [],
  },
] as const;

function CheckIcon({ color }: { color: string }) {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill={color} fillOpacity="0.15" stroke={color} strokeOpacity="0.4" />
      <path d="M5 8l2 2 4-4" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 16 16" fill="none">
      <circle cx="8" cy="8" r="7" fill="#1a2035" />
      <path d="M6 6l4 4M10 6l-4 4" stroke="#2a3045" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export default function UpgradePage() {
  const { user } = useAuth();
  const userId   = (user as { username?: string })?.username ?? "???";
  const sinpeRef = `syntra-${userId.substring(0, 8)}`;

  const [selectedPlan, setSelectedPlan] = useState<"pro" | "elite">("pro");

  const currentPlan = (user as { plan?: string })?.plan ?? "free";

  function whatsappMessage(plan: "pro" | "elite") {
    const prices: Record<string, string> = { pro: "$9", elite: "$19" };
    return encodeURIComponent(
      `Hola, quiero activar el plan ${plan.toUpperCase()} de SYNTRA (${prices[plan]}/mes).\n` +
      `Mi referencia SINPE: ${sinpeRef}\n` +
      `Mi correo: ${(user as { email?: string })?.email ?? "—"}`
    );
  }

  return (
    <div
      className="min-h-screen py-10 px-4"
      style={{ background: "#0a0d14" }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-2xl font-bold text-white">Elige tu plan</h1>
          <p className="text-sm text-dim mt-2">
            Mejora tu rendimiento con señales automáticas + ML
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
          {PLANS.map((plan) => {
            const isCurrent = currentPlan === plan.id;
            const isSelected = selectedPlan === plan.id;

            return (
              <div
                key={plan.id}
                className="rounded-xl p-6 flex flex-col relative cursor-pointer transition-all"
                style={{
                  background: "#0f1520",
                  border: `1px solid ${isSelected && (plan.id as string) !== "free" ? plan.color : "#1a2035"}`,
                  boxShadow: isSelected && (plan.id as string) !== "free"
                    ? `0 0 30px ${plan.color}12`
                    : "none",
                }}
                onClick={() => plan.id !== "free" && setSelectedPlan(plan.id as "pro" | "elite")}
              >
                {/* Popular badge */}
                {"popular" in plan && plan.popular && (
                  <div
                    className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-[10px] font-bold"
                    style={{ background: "#508cff", color: "#0a0d14" }}
                  >
                    MÁS POPULAR
                  </div>
                )}

                {/* Plan name & price */}
                <div className="mb-5">
                  <span
                    className="text-xs font-bold tracking-widest uppercase"
                    style={{ color: plan.color }}
                  >
                    {plan.name}
                  </span>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-3xl font-bold text-white">{plan.price}</span>
                    {"period" in plan && plan.period && (
                      <span className="text-sm text-dim">{plan.period}</span>
                    )}
                  </div>
                  {isCurrent && (
                    <span
                      className="inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{ background: `${plan.color}20`, color: plan.color }}
                    >
                      Plan actual
                    </span>
                  )}
                </div>

                {/* Features */}
                <ul className="space-y-2.5 flex-1">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-white">
                      <CheckIcon color={plan.color} />
                      {f}
                    </li>
                  ))}
                  {("missing" in plan ? plan.missing : []).map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-dim line-through">
                      <XIcon />
                      {f}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {/* SINPE Instructions */}
        {currentPlan === "free" && (
          <div
            className="rounded-xl p-6 mb-6 max-w-2xl mx-auto"
            style={{ background: "#0f1520", border: "1px solid #1a2035" }}
          >
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <span style={{ color: "#00e5a0" }}>◈</span>
              Cómo activar tu plan
            </h2>

            <ol className="space-y-4">
              {[
                {
                  step: "1",
                  title: "Abre SINPE Móvil",
                  desc: "En tu banco o app de SINPE",
                },
                {
                  step: "2",
                  title: "Envía el pago",
                  desc: (
                    <span>
                      Al número{" "}
                      <span className="font-mono font-bold text-white px-1.5 py-0.5 rounded"
                        style={{ background: "#141c2e" }}>
                        {WHATSAPP_NUMBER}
                      </span>
                      {" "}por{" "}
                      <span className="font-bold" style={{ color: "#00e5a0" }}>
                        {selectedPlan === "pro" ? "$9" : "$19"} USD
                      </span>
                    </span>
                  ),
                },
                {
                  step: "3",
                  title: "Usa esta referencia exacta",
                  desc: (
                    <div className="flex items-center gap-2 mt-1">
                      <code
                        className="font-mono text-base font-bold px-3 py-1.5 rounded-lg"
                        style={{ background: "#141c2e", color: "#00e5a0", letterSpacing: "0.05em" }}
                      >
                        {sinpeRef}
                      </code>
                      <button
                        onClick={() => navigator.clipboard.writeText(sinpeRef)}
                        className="text-xs text-dim hover:text-white transition-colors"
                      >
                        Copiar
                      </button>
                    </div>
                  ),
                },
                {
                  step: "4",
                  title: "Envíanos el comprobante",
                  desc: "Por WhatsApp con la referencia",
                },
              ].map(({ step, title, desc }) => (
                <li key={step} className="flex gap-4">
                  <div
                    className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5"
                    style={{ background: "rgba(0,229,160,0.15)", color: "#00e5a0" }}
                  >
                    {step}
                  </div>
                  <div>
                    <p className="text-xs font-medium text-white">{title}</p>
                    <p className="text-xs text-dim mt-0.5">{typeof desc === "string" ? desc : desc}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div
              className="mt-4 px-4 py-2.5 rounded-lg text-xs flex items-center gap-2"
              style={{ background: "rgba(0,229,160,0.05)", border: "1px solid rgba(0,229,160,0.15)" }}
            >
              <span style={{ color: "#00e5a0" }}>ℹ</span>
              <span className="text-dim">
                Tu plan se activa en menos de{" "}
                <span className="text-white">24 horas</span>{" "}
                (generalmente en minutos durante horario hábil).
              </span>
            </div>
          </div>
        )}

        {/* WhatsApp CTA */}
        {currentPlan === "free" && (
          <div className="text-center space-y-3">
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${whatsappMessage(selectedPlan)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-semibold transition-all"
              style={{ background: "#25d366", color: "#0a0d14" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
              </svg>
              Enviar comprobante por WhatsApp
            </a>
            <p className="text-xs text-dim">
              Plan{" "}
              <span className="text-white font-medium">
                {selectedPlan.toUpperCase()} — {selectedPlan === "pro" ? "$9" : "$19"}/mes
              </span>
              {" "}· Referencia:{" "}
              <span className="font-mono" style={{ color: "#00e5a0" }}>
                {sinpeRef}
              </span>
            </p>
          </div>
        )}

        {/* Already on paid plan */}
        {currentPlan !== "free" && (
          <div className="text-center">
            <p className="text-sm text-dim mb-4">
              Estás en plan{" "}
              <span className="font-bold text-white uppercase">{currentPlan}</span>.
              Para cambiar de plan, contáctanos por WhatsApp.
            </p>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(`Hola, quiero cambiar mi plan SYNTRA. Referencia: ${sinpeRef}`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium border transition-all"
              style={{ borderColor: "#1a2035", color: "#4a5570" }}
            >
              Contactar soporte
            </a>
          </div>
        )}

        <div className="text-center mt-8">
          <Link href="/dashboard" className="text-xs text-dim hover:text-white transition-colors">
            ← Volver al Dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
