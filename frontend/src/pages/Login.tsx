import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Zap, Eye, EyeOff, ArrowRight } from 'lucide-react'
import { authApi } from '../lib/api'
import { useAuthStore } from '../store/authStore'

export function Login() {
  const navigate = useNavigate()
  const { setAuth } = useAuthStore()
  const [form, setForm] = useState({ email: '', password: '' })
  const [showPw, setShowPw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const { data } = await authApi.login(form)
      setAuth(data.user, data.accessToken, data.idToken, data.refreshToken)
      navigate('/dashboard')
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
      setError(msg ?? 'Credenciales incorrectas')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-sm">

        {/* ── Brand ── */}
        <div className="mb-10 flex flex-col items-center gap-4 text-center">
          <div className="w-14 h-14 rounded-2xl bg-[#040325] flex items-center justify-center shadow-lg">
            <Zap size={24} className="text-[#ff8a71]" fill="#ff8a71" />
          </div>
          <div>
            <h1 className="text-3xl font-extrabold text-[#1a1a2e] tracking-tight">SYNTRA</h1>
            <p className="text-sm text-[#6c6d84] mt-1">Bitácora de trading profesional</p>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-5 flex items-start gap-2.5 px-4 py-3 bg-red-50 border border-red-200 rounded-2xl text-sm text-red-600">
            <span className="mt-0.5 shrink-0">⚠</span>
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <div className="bg-white rounded-3xl border border-[#eeeeee] p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-[#6c6d84] uppercase tracking-widest">
                Correo
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full h-12 bg-[#f5fafb] border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b1bf] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                placeholder="trader@ejemplo.com"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-[#6c6d84] uppercase tracking-widest">
                  Contraseña
                </label>
                <Link
                  to="/forgot-password"
                  className="text-xs text-[#ff8a71] hover:text-[#ff9d8a] font-semibold transition-colors"
                >
                  ¿Olvidaste la tuya?
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPw ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="w-full h-12 bg-[#f5fafb] border border-[#eeeeee] rounded-xl px-4 pr-11 text-sm text-[#1a1a2e] placeholder:text-[#b0b1bf] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#b0b1bf] hover:text-[#6c6d84] transition-colors"
                >
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-1 w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] active:bg-[#f07860] disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors shadow-lg shadow-[#ff8a71]/25"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <>Ingresar <ArrowRight size={16} /></>
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-[#6c6d84] mt-6">
          ¿No tienes cuenta?{' '}
          <Link to="/register" className="text-[#ff8a71] hover:text-[#ff9d8a] font-bold transition-colors">
            Regístrate gratis
          </Link>
        </p>
      </div>
    </div>
  )
}
