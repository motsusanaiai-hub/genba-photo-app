import { createClient } from '@supabase/supabase-js'
import { isValidSupabaseConfig, resolveAuthMode } from '@/lib/authMode'

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
