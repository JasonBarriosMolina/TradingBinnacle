import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  BookOpen,
  Radio,
  BarChart2,
  Settings,
  Shield,
  LogOut,
  Zap,
} from 'lucide-react'
import { useIsFetching } from '@tanstack/react-query'
import { useAuthStore } from '../store/authStore'
import { useTrialInfo } from '../hooks/useTrades'

export function Layout() {
  const { isAdmin, user, clearAuth } = useAuthStore()
  const navigate = useNavigate()
  const { isTrial, daysLeft } = useTrialInfo()
  const isFetching = useIsFetching()

  const handleLogout = () => {
    clearAuth()
    navigate('/login')
  }

  const navItems = [
    { to: '/dashboard', icon: <LayoutDashboard size={22} />, label: 'Inicio' },
    { to: '/journal',   icon: <BookOpen size={22} />,        label: 'Bitácora' },
    { to: '/signals',   icon: <Radio size={22} />,           label: 'Señales' },
    { to: '/stats',     icon: <BarChart2 size={22} />,       label: 'Stats' },
    { to: '/settings',  icon: <Settings size={22} />,        label: 'Ajustes' },
  ]

  return (
    /* Outer wrapper — shows blue-gray canvas on wide screens */
    <div className="min-h-screen bg-[#e8edf5] flex flex-col items-center">

      {/* ── Top loading bar ── */}
      {isFetching > 0 && (
        <div className="progress-bar-track">
          <div className="progress-bar-fill" />
        </div>
      )}

      {/* ── Phone shell — max 430px, white bg ── */}
      <div className="w-full max-w-[430px] min-h-screen bg-[#f5fafb] relative flex flex-col shadow-[0_0_60px_rgba(0,0,0,0.12)]">

        {/* ── Sticky top header ── */}
        <header className="sticky top-0 z-30 bg-[#040325] flex items-center justify-between px-5 h-[54px] shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-[#ff8a71] flex items-center justify-center">
              <Zap size={13} className="text-white" fill="currentColor" />
            </div>
            <span className="font-bold text-white text-base tracking-tight">SYNTRA</span>
          </div>
          <div className="flex items-center gap-3">
            {isTrial && (
              <span className="text-[10px] font-semibold bg-[#ff8a71]/20 text-[#ff8a71] px-2.5 py-1 rounded-full">
                {daysLeft}d trial
              </span>
            )}
            <span className="text-[10px] font-bold uppercase bg-white/10 text-white px-2.5 py-1 rounded-full">
              {user?.plan ?? 'free'}
            </span>
            <button
              onClick={handleLogout}
              className="text-white/50 hover:text-white transition-colors p-1"
              title="Cerrar sesión"
            >
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {/* ── Page content ── */}
        <main className="flex-1 overflow-auto pb-[80px]">
          <Outlet />
        </main>

        {/* ── Bottom nav — white bar with coral active ── */}
        <nav className="fixed bottom-0 z-40 w-full max-w-[430px] bg-white border-t border-[#eeeeee] flex items-stretch h-[70px] shadow-[0_-4px_24px_rgba(4,3,37,0.07)]">
          {navItems.map(({ to, icon, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${
                  isActive ? 'text-[#ff8a71]' : 'text-[#6c6d84]'
                }`
              }
            >
              {icon}
              <span className="text-[11px] font-semibold leading-none">{label}</span>
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink
              to="/admin"
              className={({ isActive }) =>
                `flex flex-col items-center justify-center gap-1 flex-1 transition-colors ${
                  isActive ? 'text-[#ff8a71]' : 'text-[#6c6d84]'
                }`
              }
            >
              <Shield size={22} />
              <span className="text-[11px] font-semibold leading-none">Admin</span>
            </NavLink>
          )}
        </nav>

      </div>
    </div>
  )
}
