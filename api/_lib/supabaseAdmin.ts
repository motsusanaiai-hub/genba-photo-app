import { createClient } from '@supabase/supabase-js'

/**
 * service_roleキーで生成するSupabaseクライアント。RLSを完全にバイパスするため、
 * サーバー側（Vercel Function）専用。クライアントバンドルには絶対に含めないこと
 * （SUPABASE_SERVICE_ROLE_KEY に VITE_ プレフィックスを付けないことで担保する）。
 *
 * このクライアント自体はDBを直接更新するためには使わない。
 * plan / ads_removed_purchased_at の更新は必ず public.grant_ads_removed 等の
 * SECURITY DEFINER RPC経由で行い、業務ロジックをWebhook側に書き散らさない。
 */
export function createSupabaseAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
