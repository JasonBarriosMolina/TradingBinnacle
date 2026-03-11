import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, CheckCircle, ArrowRight } from 'lucide-react'
import { authApi } from '../lib/api'

const TRIAL_DAYS = parseInt(import.meta.env.VITE_TRIAL_DAYS ?? '30')

export function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (form.password !== form.confirmPassword) {
      setError('Las contraseñas no coinciden')
      return
    }
    if (form.password.length < 8) {
      setError('La contraseña debe tener al menos 8 caracteres')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await authApi.register({ name: form.name, email: form.email, password: form.password })
      setSuccess(true)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Error al registrarse')
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center px-5">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-green-100">
            <CheckCircle size={32} className="text-green-500" />
          </div>
          <h1 className="text-2xl font-bold text-[#1a1a2e] mb-3">¡Cuenta creada!</h1>
          <p className="text-sm text-[#6c6d84] mb-8 leading-relaxed">
            Revisa tu email para confirmar tu cuenta.<br />
            Tienes{' '}
            <span className="text-[#ff8a71] font-semibold">{TRIAL_DAYS} días gratis</span>
            {' '}con acceso completo al plan Pro.
          </p>
          <button
            onClick={() => navigate('/login')}
            className="w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] active:bg-[#ff7a60] text-white font-semibold text-sm rounded-xl transition-colors"
          >
            Ir al login <ArrowRight size={16} />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">

        {/* ── Logo ── */}
        <div className="flex flex-col items-center mb-8 gap-4">
          <div className="w-14 h-14 rounded-2xl bg-[#040325] flex items-center justify-center shadow-lg">
            <Zap size={24} className="text-[#ff8a71]" fill="#ff8a71" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-extrabold text-[#1a1a2e] tracking-tight">Crea tu cuenta</h1>
            <p className="text-sm text-[#6c6d84] mt-1">
              <span className="text-[#ff8a71] font-semibold">{TRIAL_DAYS} días gratis</span>
              {' '}— sin tarjeta de crédito
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

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {/* Name */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                Nombre
              </label>
              <input
                type="text"
                required
                autoComplete="name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                placeholder="Tu nombre"
              />
            </div>

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                Correo
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                placeholder="trader@ejemplo.com"
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                Contraseña
              </label>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 pr-11 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="Mínimo 8 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#b0b2c0] hover:text-[#6c6d84] transition-colors"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-semibold text-[#6c6d84] uppercase tracking-wider">
                Confirmar contraseña
              </label>
              <input
                type="password"
                required
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full h-12 bg-white border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b2c0] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                placeholder="••••••••"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] active:bg-[#ff7a60] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>Crear cuenta gratis <ArrowRight size={16} /></>
              )}
            </button>
          </form>
        </div>

        {/* Login link */}
        <p className="text-center text-sm text-[#6c6d84] mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link to="/login" className="text-[#ff8a71] hover:text-[#ff9d8a] font-semibold transition-colors">
            Ingresar
          </Link>
        </p>
      </div>
    </div>
  )
}
