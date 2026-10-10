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
 * URL は new URL() で解析できるものだけを有効とする。https:// で始まっていても形式が壊れていると
 * createClient が読み込み時に例外を投げ、画面が真っ白になるため、ここで misconfigured / mock に振り分ける。
 */
export type AuthMode = 'supabase' | 'mock' | 'misconfigured'

export function isValidSupabaseConfig(url: string, anonKey: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return (
    parsed.protocol === 'https:' &&
    parsed.hostname !== '' &&
    parsed.username === '' &&
    parsed.password === '' &&
    !url.includes('placeholder') &&
    anonKey.length > 20
  )
}

export function resolveAuthMode(input: { url: string; anonKey: string; isProd: boolean }): AuthMode {
  if (isValidSupabaseConfig(input.url, input.anonKey)) return 'supabase'
  return input.isProd ? 'misconfigured' : 'mock'
}
