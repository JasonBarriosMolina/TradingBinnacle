"use client";

import React from "react";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";

export default function SettingsPage() {
  const { user, logout } = useAuth();
  const plan = (user?.plan ?? "free") as "free" | "pro" | "elite";

  return (
    <div className="space-y-5 max-w-xl">
      <div>
        <h1 className="text-lg font-semibold text-white">Configuración</h1>
        <p className="text-xs text-dim mt-0.5">Cuenta y preferencias</p>
      </div>

      <Card title="Cuenta">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-dim">Email</p>
              <p className="text-sm text-white mt-0.5">{user?.email ?? "—"}</p>
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-dim">Plan</p>
              <div className="mt-1">
                <Badge variant={plan}>{plan.toUpperCase()}</Badge>
              </div>
            </div>
            {plan !== "elite" && (
              <a
                href="/upgrade"
                className="text-xs px-3 py-1.5 rounded"
                style={{ background: "rgba(255,208,96,0.1)", border: "1px solid rgba(255,208,96,0.3)", color: "#ffd060" }}
              >
                Upgrade ↗
              </a>
            )}
          </div>
          <div className="border-t border-border pt-4">
            <button
              onClick={logout}
              className="text-xs px-4 py-2 rounded transition-colors"
              style={{ background: "rgba(255,68,102,0.1)", border: "1px solid rgba(255,68,102,0.3)", color: "#ff4466" }}
            >
              Cerrar Sesión
            </button>
          </div>
        </div>
      </Card>

      <Card title="API / MT5">
        <p className="text-xs text-dim">
          Conecta tu cuenta MT5 para sincronización automática de operaciones.
        </p>
        <div className="mt-4 px-3 py-2 rounded text-xs" style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#4a5570" }}>
          Disponible en plan PRO — conecta tu MetaApi token en la configuración del servidor.
        </div>
      </Card>

      <Card title="Notificaciones">
        <p className="text-xs text-dim">
          Configura alertas por WhatsApp para señales nuevas.
        </p>
        <div className="mt-3">
          <label className="block text-xs text-dim mb-1">Número WhatsApp</label>
          <input
            type="tel"
            placeholder="+1234567890"
            className="w-full px-3 py-2 rounded text-sm bg-surface2 border border-border text-white focus:border-green outline-none"
          />
        </div>
      </Card>
    </div>
  );
}
