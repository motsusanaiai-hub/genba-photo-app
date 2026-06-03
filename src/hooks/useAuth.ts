import { useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import { supabase, isSupabaseConfigured } from '@/lib/supabase'
import type { AppUser } from '@/types/auth'

const MOCK_USER_KEY = 'genba_mock_user'

// StrictModeで二重実行されないよう、モジュールレベルで管理
let initStarted = false

export function useAuth() {
  const { setUser, setInitialized } = useAuthStore()

  const initialize = useCallback(async () => {
    if (initStarted) return
    initStarted = true

    if (!isSupabaseConfigured || !supabase) {
      console.info('[開発モード] Supabaseが未設定のため、モック認証で動作します。')
      const stored = localStorage.getItem(MOCK_USER_KEY)
      if (stored) {
        try {
          setUser(JSON.parse(stored) as AppUser)
        } catch {
          localStorage.removeItem(MOCK_USER_KEY)
        }
      }
      setInitialized(true)
      return
    }

    const {
      data: { session },
    } = await supabase.auth.getSession()

    if (session?.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, display_name, plan')
        .eq('id', session.user.id)
        .single()
      if (profile) {
        setUser({
          id: profile.id as string,
          email: session.user.email ?? '',
          display_name: profile.display_name as string,
          plan: (profile.plan as 'free' | 'paid') ?? 'free',
        })
      }
    }
    setInitialized(true)

    const {
      data: { subscription },
    } = supabase!.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        const { data: profile } = await supabase!
          .from('profiles')
          .select('id, display_name, plan')
          .eq('id', session.user.id)
          .single()
        setUser(
          profile
            ? {
                id: profile.id as string,
                email: session.user.email ?? '',
                display_name: profile.display_name as string,
                plan: (profile.plan as 'free' | 'paid') ?? 'free',
              }
            : null,
        )
      } else {
        setUser(null)
      }
    })

    return () => subscription.unsubscribe()
  }, [setUser, setInitialized])

  const signIn = async (email: string, password: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const user: AppUser = {
        id: `mock-${email}`,
        email,
        display_name: email.split('@')[0],
        plan: 'free',
      }
      localStorage.setItem(MOCK_USER_KEY, JSON.stringify(user))
      setUser(user)
      return { error: null }
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  const signUp = async (email: string, password: string, displayName: string) => {
    if (!isSupabaseConfigured || !supabase) {
      const user: AppUser = {
        id: `mock-${email}`,
        email,
        display_name: displayName,
        plan: 'free',
      }
      localStorage.setItem(MOCK_USER_KEY, JSON.stringify(user))
      setUser(user)
      return { error: null }
    }
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { display_name: displayName } },
    })
    return { error }
  }

  const signOut = async () => {
    if (!isSupabaseConfigured || !supabase) {
      localStorage.removeItem(MOCK_USER_KEY)
      setUser(null)
      return
    }
    await supabase.auth.signOut()
    setUser(null)
  }

  return { initialize, signIn, signUp, signOut, isConfigured: isSupabaseConfigured }
}
