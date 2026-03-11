import { useState } from 'react'
import { useMT5Auth } from '../hooks/useMT5Auth'
import { useRequestPushPermission } from '../hooks/useSignals'
import { useAuthStore } from '../store/authStore'
import { Wifi, Bell, BellOff, User, CreditCard, Shield, Eye, EyeOff, CheckCircle2, AlertCircle } from 'lucide-react'
import { formatDate } from '../lib/dateUtils'
import { useTrialInfo } from '../hooks/useTrades'

const STATUS_LABELS = {
  trial: 'En prueba',
  pending: 'Pago pendiente',
  active: 'Activo',
  suspended: 'Suspendido',
}
const MONTHLY_PRICE = import.meta.env.VITE_MONTHLY_PRICE_USD ?? '3.99'
const SINPE_NUMBER  = import.meta.env.VITE_BANK_INFO_SINPE ?? ''
const BANK_ACCOUNT  = import.meta.env.VITE_BANK_INFO_CUENTA ?? ''

export function Settings() {
  const { user } = useAuthStore()
  const mt5 = useMT5Auth()
  const requestPush = useRequestPushPermission()
  const { isTrial, daysLeft } = useTrialInfo()
  const [pushMsg, setPushMsg] = useState<string | null>(null)
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default',
  )

  const [mt5Login, setMt5Login]       = useState('')
  const [mt5Password, setMt5Password] = useState('')
  const [mt5Server, setMt5Server]     = useState('Deriv-Demo')
  const [showMt5Password, setShowMt5Password] = useState(false)

  const handleEnablePush = async () => {
    const ok = await requestPush()
    if (ok) {
      setNotifPermission('granted')
      setPushMsg('Notificaciones activadas correctamente.')
    } else {
      setPushMsg('No se pudo activar. Revisa los permisos del navegador.')
    }
  }

  const handleMt5Connect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!mt5Login.trim() || !mt5Password.trim()) return
    const ok = await mt5.connect(mt5Login.trim(), mt5Password, mt5Server)
    if (ok) { setMt5Login(''); setMt5Password('') }
  }

  return (
    <div className="pb-4">

      {/* Header */}
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-[#eeeeee] px-5 py-4">
        <h1 className="text-base font-bold text-[#1a1a2e]">Ajustes</h1>
      </div>

      <div className="px-5 pt-5 space-y-4">

        {/* ── Perfil ── */}
        <Section icon={<User size={15} />} title="Perfil">
          <div className="grid grid-cols-1 gap-4">
            <InfoRow label="Nombre" value={user?.name ?? '—'} />
            <InfoRow label="Email"  value={user?.email ?? '—'} />
          </div>
        </Section>

        {/* ── Suscripción ── */}
        <Section icon={<CreditCard size={15} />} title="Suscripción">
          <div className="flex flex-col divide-y divide-[#eeeeee] mb-4">
            <InfoRowInline label="Plan actual">
              <span className="font-mono font-bold text-sm text-[#ff8a71] uppercase">{user?.plan}</span>
            </InfoRowInline>
            <InfoRowInline label="Estado">
              <span className={`text-sm font-semibold ${
                user?.status === 'active'    ? 'text-green-600'
                : user?.status === 'suspended' ? 'text-red-500'
                : 'text-amber-600'
              }`}>
                {STATUS_LABELS[user?.status ?? 'pending']}
              </span>
            </InfoRowInline>
            {isTrial && (
              <InfoRowInline label="Trial vence">
                <span className="font-mono text-sm text-amber-600">
                  {daysLeft}d ({formatDate(user?.trialEndsAt ?? '')})
                </span>
              </InfoRowInline>
            )}
          </div>

          {(isTrial || user?.status === 'pending') && (
            <div className="p-4 bg-[#ff8a71]/8 border border-[#ff8a71]/25 rounded-2xl">
              <p className="text-sm font-bold text-[#1a1a2e] mb-1">
                Suscripción mensual:{' '}
                <span className="text-[#ff8a71] font-mono">${MONTHLY_PRICE}</span>
              </p>
              <p className="text-xs text-[#6c6d84] mb-4">Activación manual en 24h hábiles.</p>
              {SINPE_NUMBER && (
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="text-xs text-[#6c6d84]">SINPE Móvil</span>
                  <code className="font-mono text-sm text-[#1a1a2e] bg-white border border-[#eeeeee] px-2.5 py-1 rounded-lg">
                    {SINPE_NUMBER}
                  </code>
                </div>
              )}
              {BANK_ACCOUNT && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#6c6d84]">IBAN</span>
                  <code className="font-mono text-xs text-[#1a1a2e] bg-white border border-[#eeeeee] px-2.5 py-1 rounded-lg break-all">
                    {BANK_ACCOUNT}
                  </code>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* ── MT5 Connection ── */}
        <Section icon={<Wifi size={15} />} title="Conexión MT5">
          {mt5.isConnected ? (

            /* CONNECTED */
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-xl">
                <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={20} className="text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-green-700">Cuenta MT5 conectada</p>
                  <p className="text-xs text-green-500 mt-0.5">Sincronización automática diaria activa</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#f5fafb] border border-[#eeeeee] rounded-xl p-3.5">
                  <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-1.5">Login ID</p>
                  <p className="font-mono font-bold text-[#1a1a2e]">{mt5.loginId ?? '—'}</p>
                </div>
                <div className="bg-[#f5fafb] border border-[#eeeeee] rounded-xl p-3.5">
                  <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-1.5">Tipo</p>
                  <span className={`inline-block font-mono font-bold text-xs px-2.5 py-1 rounded-lg ${
                    mt5.accountType === 'demo'
                      ? 'bg-[#ff8a71]/10 text-[#ff8a71]'
                      : 'bg-green-50 text-green-600'
                  }`}>
                    {mt5.accountType === 'demo' ? 'DEMO' : mt5.accountType === 'real' ? 'REAL' : '—'}
                  </span>
                </div>
              </div>

              {mt5.lastSync && (
                <p className="text-xs text-[#6c6d84]">
                  Última sync:{' '}
                  <span className="text-[#1a1a2e] font-mono font-medium">{formatDate(mt5.lastSync)}</span>
                </p>
              )}

              <p className="text-xs text-[#6c6d84]">
                Sincronización automática diaria a las 6am UTC. Para sincronizar manualmente, ve a la{' '}
                <a href="/journal" className="text-[#ff8a71] font-semibold">Bitácora</a>.
              </p>

              <button
                onClick={() => mt5.disconnect()}
                disabled={mt5.disconnecting}
                className="w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold text-red-500 border border-red-200 rounded-xl hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                {mt5.disconnecting ? <><Spinner color="red" /> Desconectando...</> : 'Desconectar MT5'}
              </button>
            </div>

          ) : (

            /* NOT CONNECTED */
            <div className="flex flex-col gap-3">
              {mt5.error && (
                <div className="flex items-start gap-2.5 p-3 bg-red-50 border border-red-200 rounded-xl">
                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <p className="text-sm text-red-500 leading-relaxed">{mt5.error}</p>
                </div>
              )}

              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-[#d4d5e0]" />
                <span className="text-sm text-[#6c6d84]">Sin conexión a MT5</span>
              </div>

              <div className="p-4 bg-[#f5fafb] border border-[#eeeeee] rounded-xl">
                <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-3">¿Qué necesitas?</p>
                <ol className="flex flex-col gap-2">
                  {[
                    'Login ID de MT5 (número de cuenta, ej: 31874245)',
                    'Contraseña de tu cuenta MT5',
                    'Servidor (Deriv-Demo o DerivSVG-Server)',
                  ].map((step, i) => (
                    <li key={i} className="flex items-start gap-3 text-xs text-[#6c6d84]">
                      <span className="w-5 h-5 rounded-full bg-[#ff8a71]/15 text-[#ff8a71] font-bold flex items-center justify-center shrink-0 text-xs">
                        {i + 1}
                      </span>
                      <span className="leading-relaxed pt-0.5">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>

              <form onSubmit={handleMt5Connect} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-widest uppercase text-[#6c6d84]">Login ID</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={mt5Login}
                    onChange={(e) => setMt5Login(e.target.value)}
                    placeholder="Ej: 31874245"
                    className="w-full h-11 bg-[#f5fafb] border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] placeholder:text-[#b0b1bf] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-widest uppercase text-[#6c6d84]">Contraseña</label>
                  <div className="relative">
                    <input
                      type={showMt5Password ? 'text' : 'password'}
                      value={mt5Password}
                      onChange={(e) => setMt5Password(e.target.value)}
                      placeholder="Contraseña de MT5"
                      className="w-full h-11 bg-[#f5fafb] border border-[#eeeeee] rounded-xl px-4 pr-11 text-sm text-[#1a1a2e] placeholder:text-[#b0b1bf] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                    />
                    <button
                      type="button"
                      onClick={() => setShowMt5Password(!showMt5Password)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#b0b1bf] hover:text-[#6c6d84] transition-colors"
                    >
                      {showMt5Password ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold tracking-widest uppercase text-[#6c6d84]">Servidor</label>
                  <select
                    value={mt5Server}
                    onChange={(e) => setMt5Server(e.target.value)}
                    className="w-full h-11 bg-[#f5fafb] border border-[#eeeeee] rounded-xl px-4 text-sm text-[#1a1a2e] focus:outline-none focus:border-[#ff8a71] focus:ring-2 focus:ring-[#ff8a71]/15 transition-all"
                  >
                    <option value="Deriv-Demo">Deriv-Demo (Demo)</option>
                    <option value="DerivSVG-Server">DerivSVG-Server (Real)</option>
                  </select>
                </div>

                <button
                  type="submit"
                  disabled={mt5.connecting || !mt5Login.trim() || !mt5Password.trim()}
                  className="w-full h-12 flex items-center justify-center gap-2 bg-[#ff8a71] hover:bg-[#ff9d8a] disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm rounded-xl transition-colors shadow-lg shadow-[#ff8a71]/25"
                >
                  {mt5.connecting
                    ? <><Spinner color="white" /> Conectando...</>
                    : <><Wifi size={14} /> Conectar cuenta MT5</>}
                </button>
              </form>
            </div>
          )}
        </Section>

        {/* ── Push notifications ── */}
        {user?.plan === 'pro' && (
          <Section icon={<Bell size={15} />} title="Notificaciones push">
            <p className="text-sm text-[#6c6d84] mb-4">
              Recibe alertas cuando se detecte una señal válida en los índices que monitoreas.
            </p>

            {/* State indicator */}
            {notifPermission === 'granted' ? (
              <div className="flex items-center gap-3 p-3.5 bg-green-50 border border-green-100 rounded-xl mb-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={16} className="text-green-600" />
                </div>
                <div>
                  <p className="text-sm font-bold text-green-700">Notificaciones activas</p>
                  <p className="text-xs text-green-500">Las alertas de señales llegarán a este dispositivo</p>
                </div>
              </div>
            ) : notifPermission === 'denied' ? (
              <div className="flex items-center gap-3 p-3.5 bg-red-50 border border-red-100 rounded-xl mb-3">
                <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                  <BellOff size={16} className="text-red-500" />
                </div>
                <div>
                  <p className="text-sm font-bold text-red-600">Bloqueadas por el navegador</p>
                  <p className="text-xs text-red-400">Ve a Configuración del sitio y permite notificaciones</p>
                </div>
              </div>
            ) : null}

            {pushMsg && (
              <p className={`text-xs font-medium mb-3 ${pushMsg.includes('activadas') ? 'text-green-600' : 'text-red-500'}`}>
                {pushMsg}
              </p>
            )}

            {notifPermission !== 'granted' && notifPermission !== 'denied' && (
              <button
                onClick={handleEnablePush}
                className="h-11 px-5 bg-[#ff8a71] hover:bg-[#ff9d8a] text-white text-sm font-bold rounded-xl transition-colors"
              >
                Activar notificaciones
              </button>
            )}

            {notifPermission === 'granted' && (
              <button
                onClick={handleEnablePush}
                className="h-9 px-4 border border-[#eeeeee] text-[#6c6d84] hover:border-[#ff8a71] text-xs font-semibold rounded-xl transition-colors"
              >
                Renovar suscripción
              </button>
            )}
          </Section>
        )}

        {/* ── Seguridad ── */}
        <Section icon={<Shield size={15} />} title="Seguridad">
          <p className="text-sm text-[#6c6d84]">
            Para cambiar tu contraseña, usa "¿Olvidaste tu contraseña?" en la pantalla de login.
          </p>
        </Section>

      </div>
    </div>
  )
}

/* ── Sub-components ── */

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-[#eeeeee] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-5 pb-4 border-b border-[#eeeeee]">
        <span className="text-[#ff8a71]">{icon}</span>
        <h2 className="text-xs font-bold tracking-widest uppercase text-[#6c6d84]">{title}</h2>
      </div>
      {children}
    </div>
  )
}

function InfoRowInline({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm text-[#6c6d84]">{label}</span>
      {children}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold tracking-widest uppercase text-[#6c6d84] mb-1.5">{label}</p>
      <p className="text-sm font-medium text-[#1a1a2e] break-all">{value}</p>
    </div>
  )
}

function Spinner({ color = 'accent' }: { color?: 'accent' | 'red' | 'white' }) {
  const cls = {
    accent: 'border-[#ff8a71]/30 border-t-[#ff8a71]',
    red:    'border-red-200 border-t-red-500',
    white:  'border-white/30 border-t-white',
  }[color]
  return <span className={`w-3.5 h-3.5 border-2 ${cls} rounded-full animate-spin`} />
}
