import { create } from 'zustand'
import type { AppUser } from '@/types/auth'

interface AuthState {
  user: AppUser | null
  initialized: boolean
  setUser: (user: AppUser | null) => void
  setInitialized: (initialized: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  initialized: false,
  setUser: (user) => set({ user }),
  setInitialized: (initialized) => set({ initialized }),
}))
