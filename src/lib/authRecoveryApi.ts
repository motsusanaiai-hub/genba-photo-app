import { supabase, authMode } from '@/lib/supabase'
import { buildPasswordResetRedirectUrl } from '@/lib/passwordRecovery'

/**
 * パスワード再設定で使う Supabase Auth の呼び出し（標準機能のみ）。
 *   - resetPasswordForEmail … 再設定メールの送信
 *   - updateUser({ password }) … 新しいパスワードの設定（Recovery セッションで呼ぶ）
 *   - signOut({ scope: 'local' }) … 再設定に使ったセッションを、この端末だけ終了する
 * パスワード・メールアドレス・トークンは、ログにも保存にも出さない。
 * 既存の useAuth（ログイン・登録・ログアウト）には手を入れず、再設定専用の薄い層として分けてある。
 */

/** 画面側が分類に使う、エラーの最小限の情報（AuthError からコピーする。メッセージ文は持たない） */
export interface AuthErrorInfo {
  status?: number
  code?: string
  name?: string
}

export interface AuthCallResult {
  error: AuthErrorInfo | null
}

const UNAVAILABLE: AuthErrorInfo = { status: 503, code: 'unexpected_failure' }

function toInfo(error: unknown): AuthErrorInfo {
  if (typeof error === 'object' && error !== null) {
    const { status, code, name } = error as { status?: unknown; code?: unknown; name?: unknown }
    return {
      status: typeof status === 'number' ? status : undefined,
      code: typeof code === 'string' ? code : undefined,
      name: typeof name === 'string' ? name : undefined,
    }
  }
  return {}
}

function currentOrigin(): string | null {
  return typeof window === 'undefined' ? null : window.location.origin
}

/**
 * 再設定メールを送る。
 * 登録済みかどうかは、この関数も Supabase も区別しない（未登録でも成功として返る）。
 * redirectTo は「いま開いているページの origin」から作る（利用者の入力は使わない）。信頼できる形でなければ付けない。
 * 開発モード（Supabase 未設定）ではメールを送らず成功扱いにする。
 */
export async function requestPasswordResetEmail(
  email: string,
  origin: string | null = currentOrigin(),
): Promise<AuthCallResult> {
  if (authMode === 'misconfigured') return { error: UNAVAILABLE }
  if (authMode === 'mock' || !supabase) return { error: null }
  const redirectTo = buildPasswordResetRedirectUrl(origin)
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined)
    return { error: error ? toInfo(error) : null }
  } catch (error) {
    return { error: toInfo(error) }
  }
}

/** 新しいパスワードを設定する。呼び出し前に、Recovery セッションであることを確認すること。 */
export async function updateRecoveredPassword(password: string): Promise<AuthCallResult> {
  if (authMode === 'misconfigured' || authMode === 'mock' || !supabase) return { error: UNAVAILABLE }
  try {
    const { error } = await supabase.auth.updateUser({ password })
    return { error: error ? toInfo(error) : null }
  } catch (error) {
    return { error: toInfo(error) }
  }
}

/** 再設定に使ったセッションを、この端末だけ終了する（他の端末のログインは終了しない）。失敗しても例外にしない。 */
export async function signOutRecoveredSession(): Promise<void> {
  if (authMode !== 'supabase' || !supabase) return
  try {
    await supabase.auth.signOut({ scope: 'local' })
  } catch {
    // 画面上は再設定の完了として扱う（次回のログイン操作で整合する）
  }
}
