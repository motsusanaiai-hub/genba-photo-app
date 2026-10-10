import { useCallback } from 'react'
import { AuthError } from '@supabase/supabase-js'
import { useAuthStore } from '@/store/authStore'
import { supabase, isSupabaseConfigured, authMode } from '@/lib/supabase'
import type { AppUser, Plan } from '@/types/auth'

const MOCK_USER_KEY = 'genba_mock_user'

/**
 * 本番ビルドで Supabase の設定が不足している場合に signIn / signUp が返すエラー。
 * 呼び出し側の型（AuthError）に合わせる。通常は App が設定エラー画面を出すため到達しない。
 */
const MISCONFIGURED_ERROR = new AuthError(
  '認証サービスの設定が完了していないため、現在ご利用いただけません。',
  503,
  'unexpected_failure',
)

// StrictModeで二重実行されないよう、モジュールレベルで管理
let initStarted = false

export function useAuth() {
  const { setUser, setInitialized } = useAuthStore()

  const initialize = useCallback(async () => {
    if (initStarted) return
    initStarted = true

    if (authMode === 'misconfigured') {
      // 本番ビルドで Supabase の設定が不足している。モック認証には切り替えず、
      // 保存済みのモックユーザーも読み込まない（App が設定エラー画面を表示する）。
      console.error('[auth] Supabase の設定が不足しているため、認証を開始できません。')
      setInitialized(true)
      return
    }

    if (authMode === 'mock' || !supabase) {
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
          plan: (profile.plan as Plan) ?? 'free',
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
                plan: (profile.plan as Plan) ?? 'free',
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
    if (authMode === 'misconfigured') return { error: MISCONFIGURED_ERROR }
    if (authMode === 'mock' || !supabase) {
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
    if (authMode === 'misconfigured') return { error: MISCONFIGURED_ERROR }
    if (authMode === 'mock' || !supabase) {
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
    if (authMode === 'misconfigured') {
      setUser(null)
      return
    }
    if (authMode === 'mock' || !supabase) {
      localStorage.removeItem(MOCK_USER_KEY)
      setUser(null)
      return
    }
    await supabase.auth.signOut()
    setUser(null)
  }

  return { initialize, signIn, signUp, signOut, isConfigured: isSupabaseConfigured, authMode }
}
