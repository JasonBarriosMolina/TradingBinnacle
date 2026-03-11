import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../shared/types'

interface AuthState {
  user: User | null
  accessToken: string | null
  idToken: string | null
  refreshToken: string | null
  isAuthenticated: boolean
  isAdmin: boolean

  setAuth: (user: User, accessToken: string, idToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, idToken: string) => void
  updateUser: (updates: Partial<User>) => void
  clearAuth: () => void
}

const ADMIN_IDS = (import.meta.env.VITE_ADMIN_USER_IDS ?? '').split(',').filter(Boolean)

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      accessToken: null,
      idToken: null,
      refreshToken: null,
      isAuthenticated: false,
      isAdmin: false,

      setAuth: (user, accessToken, idToken, refreshToken) =>
        set({
          user,
          accessToken,
          idToken,
          refreshToken,
          isAuthenticated: true,
          isAdmin: ADMIN_IDS.includes(user.userId),
        }),

      setTokens: (accessToken, idToken) =>
        set({ accessToken, idToken }),

      updateUser: (updates) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      clearAuth: () =>
        set({ user: null, accessToken: null, idToken: null, refreshToken: null, isAuthenticated: false, isAdmin: false }),
    }),
    {
      name: 'syntra-auth',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        idToken: state.idToken,
        refreshToken: state.refreshToken,
        isAuthenticated: state.isAuthenticated,
        isAdmin: state.isAdmin,
      }),
    },
  ),
)
