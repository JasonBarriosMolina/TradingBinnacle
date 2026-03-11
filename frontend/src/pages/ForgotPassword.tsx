import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Zap, ArrowLeft, ArrowRight, CheckCircle } from 'lucide-react'
import { authApi } from '../lib/api'

export function ForgotPassword() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [form, setForm] = useState({ code: '', newPassword: '', confirm: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      await authApi.forgotPassword(email)
      setStep('code')
    } catch {
      setError('No se pudo enviar el código. Verifica el email.')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirm = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.newPassword !== form.confirm) {
      setError('Las contraseñas no coinciden')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await authApi.confirmResetPassword({ email, code: form.code, newPassword: form.newPassword })
      setDone(true)
    } catch {
      setError('Código inválido o expirado')
    } finally {
      setLoading(false)
    }
  }

  /* ─── Success ─── */
  if (done) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-5">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-green-100">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e] mb-3">Contraseña actualizada</h1>
          <p className="text-sm text-[#6c6d84] mb-8">
            Ya puedes iniciar sesión con tu nueva contraseña.
          </p>
          <Link
            to="/login"
            className="w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] text-white font-bold text-sm rounded-xl transition-colors"
          >
            Ir al login <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    )
  }

  /* ─── Main ─── */
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">

        {/* ── Logo ── */}
        <div className="flex flex-col items-center mb-8 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#040325] flex items-center justify-center shadow-lg">
            <Zap size={24} className="text-[#ff8a71]" fill="#ff8a71" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold text-[#1a1a2e] tracking-tight">
              {step === 'email' ? 'Recuperar acceso' : 'Nueva contraseña'}
            </h1>
            <p className="text-sm text-[#6c6d84] mt-1">
              {step === 'email'
                ? 'Te enviaremos un código a tu correo.'
                : <>Código enviado a <span className="text-[#1a1a2e] font-semibold">{email}</span></>
              }
            </p>
          </div>
        </div>

        {/* ── Card ── */}
        <div className="bg-white rounded-3xl border border-[#eeeeee] p-6 shadow-sm">

          {error && (
            <div className="mb-5 flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600">
              <span className="mt-0.5 shrink-0">⚠</span>
              <span>{error}</span>
            </div>
          )}

          {step === 'email' ? (
            <form onSubmit={handleSendCode} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                  Correo
                </label>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="trader@ejemplo.com"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] active:bg-[#ff7a60] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Enviar código <ArrowRight size={16} /></>
                )}
              </button>
            </form>
          ) : (
            <form onSubmit={handleConfirm} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                  Código de verificación
                </label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 font-mono text-base tracking-[0.3em] text-[#1a1a2e] placeholder:text-[#b0b2c0] placeholder:tracking-normal focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="123456"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                  Nueva contraseña
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={(e) => setForm({ ...form, newPassword: e.target.value })}
                  className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="Mínimo 8 caracteres"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                  Confirmar contraseña
                </label>
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={form.confirm}
                  onChange={(e) => setForm({ ...form, confirm: e.target.value })}
                  className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="••••••••"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="mt-1 w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] active:bg-[#ff7a60] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors"
              >
                {loading ? (
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>Actualizar contraseña <ArrowRight size={16} /></>
                )}
              </button>
            </form>
          )}
        </div>

        {/* Back link */}
        <div className="mt-6 text-center">
          <Link
            to="/login"
            className="inline-flex items-center gap-1.5 text-sm text-[#6c6d84] hover:text-[#1a1a2e] transition-colors"
          >
            <ArrowLeft size={15} />
            Volver al login
          </Link>
        </div>
      </div>
    </div>
  )
}
