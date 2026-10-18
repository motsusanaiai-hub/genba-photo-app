import { z } from 'zod'
import { passwordSchema } from '@/lib/signupSchema'
import type { AuthCallResult, AuthErrorInfo } from '@/lib/authRecoveryApi'
import type { AuthUrlError, RecoveryState } from '@/lib/passwordRecovery'

/**
 * パスワード再設定の2つの画面の「状態と操作」。画面（React）から切り離した外部ストアにしてある
 * （subscribe / getSnapshot のかたち。useSyncExternalStore でつなぐ）。
 * 画面のイベントハンドラは、ここのメソッドを呼ぶだけにして、二重送信の防止・入力検証・Recovery の確認・
 * エラーの分類は、すべてここでテストできるようにしている。
 *
 * セキュリティ上の約束：
 *   - メールアドレス・パスワードは、ログにも localStorage / sessionStorage にも出さない（画面の状態＝メモリにだけ持つ）
 *   - 登録済みかどうかを推測できる表示にしない（成功時の文言は、未登録でも同じ）
 *   - Recovery セッション（PASSWORD_RECOVERY を受け取ったこのページ）でなければ、パスワード更新を呼ばない
 */

// ─── 共通：外部ストア ─────────────────────────────────────────────

class Store<S> {
  private listeners = new Set<() => void>()
  constructor(protected state: S) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): S => this.state

  protected set(next: S) {
    this.state = next
    this.listeners.forEach((listener) => listener())
  }
}

// ─── エラーの分類（メッセージ文は見ない。status と code だけ）──────────────

function isNetworkError(error: AuthErrorInfo): boolean {
  return error.status === undefined || error.status === 0 || error.name === 'AuthRetryableFetchError'
}

function isRateLimit(error: AuthErrorInfo): boolean {
  return error.status === 429 || error.code === 'over_email_send_rate_limit' || error.code === 'over_request_rate_limit'
}

/** セッションが無い・失効している（再設定リンクの有効期限切れ、使用済みなど） */
function isSessionGone(error: AuthErrorInfo): boolean {
  return (
    error.name === 'AuthSessionMissingError' ||
    error.status === 401 ||
    error.status === 403 ||
    ['session_not_found', 'session_expired', 'bad_jwt', 'no_authorization', 'otp_expired', 'refresh_token_not_found'].includes(
      error.code ?? '',
    )
  )
}

// ─── 再設定メールの送信 ───────────────────────────────────────────

export const FORGOT_EMAIL_INVALID_MESSAGE = '有効なメールアドレスを入力してください'
export const FORGOT_SENT_MESSAGE =
  '登録されているメールアドレスの場合、パスワード再設定のご案内を送信します。メールが届かないときは、迷惑メールフォルダもご確認ください。'
export const FORGOT_NETWORK_MESSAGE = '通信エラーが発生しました。ネットワーク接続を確認してもう一度お試しください。'
export const FORGOT_RATE_LIMIT_MESSAGE = '送信回数の上限に達しました。しばらく時間を空けて再度お試しください。'
export const FORGOT_FAILED_MESSAGE = 'メールを送信できませんでした。しばらく時間を空けて再度お試しください。'

const emailSchema = z.string().trim().email(FORGOT_EMAIL_INVALID_MESSAGE)

export type ForgotStatus = 'idle' | 'submitting' | 'sent' | 'error'

export interface ForgotPasswordState {
  email: string
  status: ForgotStatus
  /** 入力欄の下に出す検証エラー */
  fieldError: string | null
  /** 送信処理の失敗（通信エラー・送信制限など）。送信先のメールアドレスは含めない */
  errorMessage: string | null
}

export interface ForgotPasswordDeps {
  requestReset: (email: string) => Promise<AuthCallResult>
}

export function forgotPasswordErrorMessage(error: AuthErrorInfo): string {
  if (isRateLimit(error)) return FORGOT_RATE_LIMIT_MESSAGE
  if (isNetworkError(error)) return FORGOT_NETWORK_MESSAGE
  return FORGOT_FAILED_MESSAGE
}

export class ForgotPasswordController extends Store<ForgotPasswordState> {
  private inFlight = false

  constructor(private deps: ForgotPasswordDeps) {
    super({ email: '', status: 'idle', fieldError: null, errorMessage: null })
  }

  setEmail = (email: string) => {
    if (this.state.status === 'submitting') return
    this.set({ ...this.state, email, fieldError: null })
  }

  /** 「別のメールアドレスで送る」など、入力に戻る */
  backToForm = () => {
    if (this.state.status === 'submitting') return
    this.set({ ...this.state, status: 'idle', errorMessage: null, fieldError: null })
  }

  submit = async (): Promise<void> => {
    // 二重送信の防止：送信中は何もしない（状態の更新を待たず、同期のフラグでも守る）
    if (this.inFlight || this.state.status === 'submitting' || this.state.status === 'sent') return

    const parsed = emailSchema.safeParse(this.state.email)
    if (!parsed.success) {
      this.set({ ...this.state, status: 'idle', fieldError: FORGOT_EMAIL_INVALID_MESSAGE, errorMessage: null })
      return
    }

    this.inFlight = true
    this.set({ ...this.state, status: 'submitting', fieldError: null, errorMessage: null })
    try {
      const { error } = await this.deps.requestReset(parsed.data)
      if (error) {
        // 原因の分類だけをログに残す（送信先は出さない）
        console.error('[password-reset] send failed', { status: error.status, code: error.code })
        this.set({ ...this.state, status: 'error', errorMessage: forgotPasswordErrorMessage(error) })
      } else {
        // 登録済みかどうかは区別しない。表示にも送信先を出さない。
        this.set({ ...this.state, status: 'sent', errorMessage: null })
      }
    } finally {
      this.inFlight = false
    }
  }
}

// ─── 新しいパスワードの設定 ───────────────────────────────────────

export const RESET_PASSWORD_MISMATCH_MESSAGE = '確認用のパスワードが一致しません'
export const RESET_NETWORK_MESSAGE = '通信エラーが発生しました。ネットワーク接続を確認してもう一度お試しください。'
export const RESET_SAME_PASSWORD_MESSAGE = '現在のパスワードとは異なるパスワードを入力してください'
export const RESET_WEAK_PASSWORD_MESSAGE = 'パスワードの強度が不十分です。別のパスワードをお試しください。'
export const RESET_FAILED_MESSAGE = 'パスワードを変更できませんでした。もう一度お試しください。'

/** checking＝再設定リンクの確認中 / ready＝入力できる / expired＝期限切れ・使用済み / invalid＝再設定リンクではない */
export type ResetPhase = 'checking' | 'ready' | 'submitting' | 'done' | 'expired' | 'invalid'

export interface ResetPasswordState {
  phase: ResetPhase
  password: string
  confirm: string
  passwordError: string | null
  confirmError: string | null
  errorMessage: string | null
}

export interface ResetPasswordDeps {
  /** このページの読み込みで PASSWORD_RECOVERY を受け取ったか（通常のログインセッションだけでは true にならない） */
  recovery: RecoveryState
  /** ページを開いた時点のURLの分類（トークンの値は含まない） */
  urlError: AuthUrlError
  mayBeRecovery: boolean
  updatePassword: (password: string) => Promise<AuthCallResult>
  signOutRecoveredSession: () => Promise<void>
}

export function resetPasswordErrorKind(error: AuthErrorInfo): 'expired' | 'same' | 'weak' | 'network' | 'other' {
  if (isSessionGone(error)) return 'expired'
  if (error.code === 'same_password') return 'same'
  if (error.code === 'weak_password') return 'weak'
  if (isNetworkError(error)) return 'network'
  return 'other'
}

const resetSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: RESET_PASSWORD_MISMATCH_MESSAGE })

export class ResetPasswordController extends Store<ResetPasswordState> {
  private inFlight = false
  private finished: 'done' | 'expired' | null = null
  private waitTimedOut = false
  /** 一度でも Recovery セッションを確認できたか（確認できた後に解除された場合は、「確認中」には戻さない） */
  private seenRecovery = false

  constructor(private deps: ResetPasswordDeps) {
    super({ phase: 'checking', password: '', confirm: '', passwordError: null, confirmError: null, errorMessage: null })
    this.state = { ...this.state, phase: this.derivePhase() }
  }

  /**
   * 画面が表示されている間、Recovery の状態の変化（PASSWORD_RECOVERY の到着・解除）を監視する。
   * 戻り値は監視の解除（useEffect のクリーンアップに渡す。StrictMode の再実行でも安全）。
   */
  start = (): (() => void) => {
    this.refresh()
    return this.deps.recovery.subscribe(() => this.refresh())
  }

  private derivePhase(): ResetPhase {
    if (this.finished === 'done') return 'done'
    if (this.inFlight) return 'submitting'
    if (this.finished === 'expired' || this.deps.urlError === 'expired') return 'expired'
    if (this.deps.urlError === 'invalid') return 'invalid'
    if (this.deps.recovery.isRecovery()) {
      this.seenRecovery = true
      return 'ready'
    }
    // 再設定リンクから戻った直後は、Supabase が PASSWORD_RECOVERY を通知するまで少し待つ
    if (this.deps.mayBeRecovery && !this.waitTimedOut && !this.seenRecovery) return 'checking'
    return 'invalid'
  }

  private refresh() {
    const phase = this.derivePhase()
    if (phase !== this.state.phase) this.set({ ...this.state, phase })
  }

  /** 一定時間待っても PASSWORD_RECOVERY が来なければ、再設定リンクではないものとして扱う */
  waitTimeout = () => {
    this.waitTimedOut = true
    this.refresh()
  }

  setPassword = (password: string) => {
    if (this.state.phase !== 'ready') return
    this.set({ ...this.state, password, passwordError: null, errorMessage: null })
  }

  setConfirm = (confirm: string) => {
    if (this.state.phase !== 'ready') return
    this.set({ ...this.state, confirm, confirmError: null, errorMessage: null })
  }

  submit = async (): Promise<void> => {
    // 二重送信の防止
    if (this.inFlight || this.state.phase === 'submitting' || this.state.phase === 'done') return

    // Recovery セッションでなければ、パスワード更新は呼ばない（通常のログインセッションだけでは許可しない）
    if (!this.deps.recovery.isRecovery()) {
      this.refresh()
      return
    }
    if (this.state.phase !== 'ready') return

    const parsed = resetSchema.safeParse({ password: this.state.password, confirm: this.state.confirm })
    if (!parsed.success) {
      const issue = (key: string) => parsed.error.issues.find((i) => i.path[0] === key)?.message ?? null
      this.set({ ...this.state, passwordError: issue('password'), confirmError: issue('confirm') })
      return
    }

    this.inFlight = true
    this.set({ ...this.state, phase: 'submitting', passwordError: null, confirmError: null, errorMessage: null })
    try {
      const { error } = await this.deps.updatePassword(parsed.data.password)
      if (!error) {
        // 再設定に使ったセッションはこの端末だけ終了し、新しいパスワードでログインし直してもらう
        await this.deps.signOutRecoveredSession()
        this.deps.recovery.clear()
        this.finished = 'done'
        this.inFlight = false
        this.set({ ...this.state, phase: 'done', password: '', confirm: '', errorMessage: null })
        return
      }

      console.error('[password-reset] update failed', { status: error.status, code: error.code })
      const kind = resetPasswordErrorKind(error)
      this.inFlight = false
      if (kind === 'expired') {
        this.deps.recovery.clear()
        this.finished = 'expired'
        this.set({ ...this.state, phase: 'expired', password: '', confirm: '' })
        return
      }
      const errorMessage =
        kind === 'same'
          ? RESET_SAME_PASSWORD_MESSAGE
          : kind === 'weak'
            ? RESET_WEAK_PASSWORD_MESSAGE
            : kind === 'network'
              ? RESET_NETWORK_MESSAGE
              : RESET_FAILED_MESSAGE
      this.set({ ...this.state, phase: this.derivePhase(), errorMessage })
    } finally {
      this.inFlight = false
    }
  }
}
