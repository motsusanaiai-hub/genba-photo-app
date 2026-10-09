/**
 * 認証方式の判定（純粋関数）。
 *
 * - 'supabase'       … Supabase の設定が揃っている。通常の認証を使う
 * - 'mock'           … 開発ビルドで Supabase が未設定。開発用のモック認証を使う
 * - 'misconfigured'  … 本番ビルドで Supabase が未設定・不正。モック認証には切り替えず、
 *                      認証処理を止めて設定エラーを表示する
 *
 * 本番ビルドで環境変数の設定漏れがあった場合に、パスワード無しで通るモック認証へ
 * 黙って切り替わらないようにするため、モックは開発ビルド（isProd = false）でだけ許可する。
 * 判定条件（https・placeholder でない・anon key の長さ）は従来の isSupabaseConfigured と同じ。
 */
export type AuthMode = 'supabase' | 'mock' | 'misconfigured'

export function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  return url.startsWith('https://') && !url.includes('placeholder') && anonKey.length > 20
}

export function resolveAuthMode(input: { url: string; anonKey: string; isProd: boolean }): AuthMode {
  if (isValidSupabaseConfig(input.url, input.anonKey)) return 'supabase'
  return input.isProd ? 'misconfigured' : 'mock'
}
