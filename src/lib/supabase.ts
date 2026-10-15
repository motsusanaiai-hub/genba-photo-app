import { createClient } from '@supabase/supabase-js'
import { isValidSupabaseConfig, resolveAuthMode } from '@/lib/authMode'
import { watchPasswordRecovery } from '@/lib/passwordRecovery'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''

export const isSupabaseConfigured = isValidSupabaseConfig(supabaseUrl, supabaseAnonKey)

/** 認証方式。本番ビルドで設定が不足している場合は 'misconfigured'（モック認証には切り替えない）。 */
export const authMode = resolveAuthMode({
  url: supabaseUrl,
  anonKey: supabaseAnonKey,
  isProd: import.meta.env.PROD,
})

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// パスワード再設定リンクから戻ったときの PASSWORD_RECOVERY は、supabase-js の初期化の直後に通知される。
// 取りこぼさないよう、クライアントを作った直後（同期的）に監視を始める。通常のログインでは Recovery にならない。
if (supabase) watchPasswordRecovery(supabase.auth)
