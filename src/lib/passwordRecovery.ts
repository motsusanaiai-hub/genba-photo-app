/**
 * パスワード再設定（Supabase Auth の Recovery フロー）まわりの、認証とは独立した小さな部品。
 *
 * 独自の認証システムは作らない。トークンや認証コードの検証・交換は supabase-js（標準処理）に任せ、
 * ここでは次の3つだけを扱う：
 *   1. 再設定メールのリンク先（redirectTo）を、信頼できる origin からだけ作る
 *   2. 読み込み時のURLから、リンクの種類（再設定リンクか／期限切れ・不正か）の「分類」だけを読む
 *      （トークンや認証コードの値は読み取らない・保持しない・出力しない）
 *   3. 「このページの読み込みで Supabase が PASSWORD_RECOVERY を通知した」という事実をメモリにだけ保持する
 *
 * ログイン中であること（通常のセッション）だけでは、再設定画面でパスワードを変更できない。
 * 変更を許可するのは、PASSWORD_RECOVERY を受け取った直後の Recovery セッションだけ。
 * このフラグは localStorage / sessionStorage には保存しない（再読み込みで消える＝その時点で再設定をやり直す）。
 */

/** 再設定メールから戻る画面のパス */
export const PASSWORD_RESET_PATH = '/reset-password'

// ─── 1. redirectTo ──────────────────────────────────────────────

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * 再設定メールのリンク先URL（redirectTo）。
 * 引数は「ブラウザが今開いているページの origin」であり、利用者が入力したURLではない。
 * 信頼できる形のときだけ `${origin}/reset-password` を返す：
 *   - https（本番・Vercel Preview） … 認証情報（user:pass@）を含まない
 *   - http は localhost / 127.0.0.1 / [::1] のみ（ローカル開発）
 * それ以外は null（このとき redirectTo は付けず、Supabase の Site URL に戻る）。
 * 最終的に許可されるURLは、Supabase 管理画面の Redirect URLs の設定による。
 */
export function buildPasswordResetRedirectUrl(origin: string | null | undefined): string | null {
  if (typeof origin !== 'string' || origin.length === 0) return null
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.pathname !== '/' || url.search || url.hash) return null
  if (url.origin !== origin.replace(/\/$/, '')) return null
  const trusted = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
  if (!trusted) return null
  return `${url.origin}${PASSWORD_RESET_PATH}`
}

// ─── 2. URL の分類（値は読まない）───────────────────────────────

export type AuthUrlError = 'expired' | 'invalid' | null

export interface AuthUrlState {
  /** URLに認証エラーが付いていたか（期限切れ／それ以外）。エラー文やトークンは保持しない。 */
  error: AuthUrlError
  /**
   * 再設定リンクから戻ってきた可能性があるか。
   * implicit フロー：ハッシュに type=recovery、PKCE フロー：クエリに code。
   * 実際に再設定として確定するのは、Supabase が PASSWORD_RECOVERY を通知したときだけ。
   */
  mayBeRecovery: boolean
}

const NO_AUTH_URL: AuthUrlState = { error: null, mayBeRecovery: false }

function paramsOf(fragment: string): URLSearchParams {
  return new URLSearchParams(fragment.replace(/^[#?]/, ''))
}

/**
 * ページ読み込み時のURL（ハッシュとクエリ）から、リンクの分類だけを返す。
 * 返すのは分類のみで、access_token / refresh_token / code / error_description の値は返さない。
 */
export function parseAuthUrlState(hash: string, search: string): AuthUrlState {
  const fromHash = paramsOf(hash)
  const fromQuery = paramsOf(search)
  const get = (key: string) => fromHash.get(key) ?? fromQuery.get(key)

  const errorCode = get('error_code')
  const errorName = get('error')
  const errorDescription = get('error_description')
  if (errorCode || errorName || errorDescription) {
    const expired = errorCode === 'otp_expired' || /expired/i.test(errorDescription ?? '')
    return { error: expired ? 'expired' : 'invalid', mayBeRecovery: false }
  }

  const mayBeRecovery = get('type') === 'recovery' || (fromQuery.has('code') && !fromHash.has('type'))
  return mayBeRecovery ? { error: null, mayBeRecovery: true } : NO_AUTH_URL
}

/**
 * このページを開いた時点のURLの分類。モジュールの読み込み時（supabase-js が URL を処理する前）に1度だけ読む。
 * supabase-js はエラー付きのURLを書き換えないが、成功時はハッシュを消すため、先に読んでおく。
 */
export const initialAuthUrlState: AuthUrlState =
  typeof window === 'undefined' ? NO_AUTH_URL : parseAuthUrlState(window.location.hash, window.location.search)

// ─── 3. Recovery セッションの確認（メモリのみ）────────────────────

export interface RecoveryState {
  /** このページの読み込みで PASSWORD_RECOVERY を受け取り、まだ使い終わっていないか */
  isRecovery(): boolean
  subscribe(listener: () => void): () => void
  markRecovery(): void
  clear(): void
}

export function createRecoveryState(): RecoveryState {
  let recovery = false
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    isRecovery: () => recovery,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    markRecovery() {
      if (recovery) return
      recovery = true
      notify()
    },
    clear() {
      if (!recovery) return
      recovery = false
      notify()
    },
  }
}

/** アプリ全体で共有する Recovery の状態 */
export const recoveryState: RecoveryState = createRecoveryState()

/** supabase.auth のうち、ここで使う部分 */
export interface AuthEventSource {
  onAuthStateChange(callback: (event: string, session: unknown) => void): {
    data: { subscription: { unsubscribe(): void } }
  }
}

/**
 * Supabase Auth のイベントを監視して Recovery の状態を更新する。
 * PASSWORD_RECOVERY は supabase-js の初期化が終わった直後に通知されるため、クライアントを作った直後（同期的）に
 * 呼ぶこと。SIGNED_IN / INITIAL_SESSION / TOKEN_REFRESHED など、通常のログインのイベントでは Recovery にしない。
 * SIGNED_OUT で Recovery を解除する。トークンやセッションの中身は読まない。
 */
export function watchPasswordRecovery(auth: AuthEventSource, state: RecoveryState = recoveryState): () => void {
  const { data } = auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') state.markRecovery()
    else if (event === 'SIGNED_OUT') state.clear()
  })
  return () => data.subscription.unsubscribe()
}
