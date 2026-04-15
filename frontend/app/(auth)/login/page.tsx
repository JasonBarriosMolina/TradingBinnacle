"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp, confirmSignUp } from "@/lib/auth";
import { useAuth } from "@/context/AuthContext";

type Mode = "login" | "register" | "confirm";

export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useAuth();

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
      await refresh();
      router.push("/dashboard");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al iniciar sesión");
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (password.length < 8) {
      setError("La contraseña debe tener al menos 8 caracteres");
      return;
    }
    setLoading(true);
    try {
      await signUp(email, password);
      setSuccess("Cuenta creada. Revisa tu email para el código de confirmación.");
      setMode("confirm");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al registrarse");
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await confirmSignUp(email, code);
      setSuccess("Email confirmado. Ya puedes iniciar sesión.");
      setMode("login");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Código inválido");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{ background: "#0a0d14" }}
    >
      {/* Dot grid background */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle, #4a5570 1px, transparent 1px)",
          backgroundSize: "28px 28px",
          animation: "dot-pulse 4s ease-in-out infinite",
        }}
      />

      {/* Card */}
      <div className="relative w-full max-w-[520px] mx-4">
        <div
          className="rounded-xl border p-8"
          style={{
            background: "#0f1520",
            borderColor: "#1a2035",
            boxShadow: "0 0 60px rgba(0,229,160,0.05)",
          }}
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold tracking-widest" style={{ color: "#00e5a0" }}>
              SYNTRA 2.0
            </h1>
            <p className="text-sm mt-2" style={{ color: "#4a5570" }}>
              Sistema de señales para Crash/Boom
            </p>
          </div>

          {/* Mode tabs */}
          {mode !== "confirm" && (
            <div className="flex rounded-lg overflow-hidden mb-6 border" style={{ borderColor: "#1a2035" }}>
              <button
                onClick={() => { setMode("login"); setError(null); }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "login"
                    ? "text-black font-semibold"
                    : "text-[#4a5570] hover:text-white"
                }`}
                style={mode === "login" ? { background: "#00e5a0" } : { background: "#141c2e" }}
              >
                Iniciar Sesión
              </button>
              <button
                onClick={() => { setMode("register"); setError(null); }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  mode === "register"
                    ? "text-black font-semibold"
                    : "text-[#4a5570] hover:text-white"
                }`}
                style={mode === "register" ? { background: "#00e5a0" } : { background: "#141c2e" }}
              >
                Registrarse
              </button>
            </div>
          )}

          {/* Error / Success */}
          {error && (
            <div className="mb-4 px-3 py-2 rounded text-sm" style={{ background: "rgba(255,68,102,0.1)", border: "1px solid rgba(255,68,102,0.3)", color: "#ff4466" }}>
              {error}
            </div>
          )}
          {success && (
            <div className="mb-4 px-3 py-2 rounded text-sm" style={{ background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.3)", color: "#00e5a0" }}>
              {success}
            </div>
          )}

          {/* Login form */}
          {mode === "login" && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="trader@example.com"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors placeholder:text-[#2a3045]"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>CONTRASEÑA</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none transition-colors placeholder:text-[#2a3045]"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "#00e5a0", color: "#0a0d14" }}
              >
                {loading ? "Verificando..." : "Iniciar Sesión"}
              </button>
            </form>
          )}

          {/* Register form */}
          {mode === "register" && (
            <form onSubmit={handleRegister} className="space-y-4">
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>EMAIL</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  placeholder="trader@example.com"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>CONTRASEÑA</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  placeholder="Min. 8 caracteres"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>CONFIRMAR CONTRASEÑA</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "#00e5a0", color: "#0a0d14" }}
              >
                {loading ? "Creando cuenta..." : "Crear Cuenta"}
              </button>
            </form>
          )}

          {/* Confirm form */}
          {mode === "confirm" && (
            <form onSubmit={handleConfirm} className="space-y-4">
              <p className="text-xs text-center" style={{ color: "#4a5570" }}>
                Se envió un código a <span style={{ color: "#e2e8f0" }}>{email}</span>
              </p>
              <div>
                <label className="block text-xs mb-1.5" style={{ color: "#4a5570" }}>CÓDIGO DE CONFIRMACIÓN</label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  required
                  placeholder="123456"
                  className="w-full px-3 py-2.5 rounded-lg text-sm outline-none text-center tracking-widest"
                  style={{ background: "#141c2e", border: "1px solid #1a2035", color: "#e2e8f0" }}
                  onFocus={(e) => (e.target.style.borderColor = "#00e5a0")}
                  onBlur={(e) => (e.target.style.borderColor = "#1a2035")}
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-lg text-sm font-semibold transition-opacity disabled:opacity-50"
                style={{ background: "#00e5a0", color: "#0a0d14" }}
              >
                {loading ? "Confirmando..." : "Confirmar Email"}
              </button>
              <button
                type="button"
                onClick={() => setMode("login")}
                className="w-full text-xs"
                style={{ color: "#4a5570" }}
              >
                Volver al inicio de sesión
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
