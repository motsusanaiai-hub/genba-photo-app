import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRecoveryState } from '@/lib/passwordRecovery'
import type { AuthCallResult } from '@/lib/authRecoveryApi'
import {
  FORGOT_EMAIL_INVALID_MESSAGE,
  FORGOT_FAILED_MESSAGE,
  FORGOT_NETWORK_MESSAGE,
  FORGOT_RATE_LIMIT_MESSAGE,
  FORGOT_SENT_MESSAGE,
  ForgotPasswordController,
  RESET_FAILED_MESSAGE,
  RESET_NETWORK_MESSAGE,
  RESET_PASSWORD_MISMATCH_MESSAGE,
  RESET_SAME_PASSWORD_MESSAGE,
  RESET_WEAK_PASSWORD_MESSAGE,
  ResetPasswordController,
  type ResetPasswordDeps,
} from '@/lib/passwordRecoveryControllers'

// パスワード再設定の「状態と操作」。画面のイベントハンドラは、これらのメソッドを呼ぶだけ。
// Supabase はすべてモック（外部サービスには接続しない）。

const OK: AuthCallResult = { error: null }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

let errorLog: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

/** ログに、メールアドレス・パスワード・トークンが含まれていないこと */
function expectNoSecretsLogged(...secrets: string[]) {
  const logged = JSON.stringify(errorLog.mock.calls)
  for (const secret of secrets) expect(logged).not.toContain(secret)
}

describe('再設定メールの送信（ForgotPasswordController）', () => {
  function setup(result: AuthCallResult | Promise<AuthCallResult> = OK) {
    const requestReset = vi.fn(async (_email: string) => result)
    const controller = new ForgotPasswordController({ requestReset })
    return { controller, requestReset }
  }

  it('正常送信：入力したメールアドレスで1回だけ送信し、案内を表示する', async () => {
    const { controller, requestReset } = setup()
    controller.setEmail('user@example.com')
    await controller.submit()

    expect(requestReset).toHaveBeenCalledTimes(1)
    expect(requestReset).toHaveBeenCalledWith('user@example.com')
    expect(controller.getSnapshot()).toMatchObject({ status: 'sent', fieldError: null, errorMessage: null })
  })

  it('前後の空白は取り除いて送信する', async () => {
    const { controller, requestReset } = setup()
    controller.setEmail('  user@example.com \n')
    await controller.submit()
    expect(requestReset).toHaveBeenCalledWith('user@example.com')
  })

  it.each(['', 'abc', 'user@', '@example.com', 'user@@example.com', 'user example@x.com'])(
    'メールアドレスの形式が不正（%j）→ 送信せず、入力欄にエラーを表示する',
    async (email) => {
      const { controller, requestReset } = setup()
      controller.setEmail(email)
      await controller.submit()

      expect(requestReset).not.toHaveBeenCalled()
      expect(controller.getSnapshot()).toMatchObject({ status: 'idle', fieldError: FORGOT_EMAIL_INVALID_MESSAGE })
    },
  )

  it('送信中はボタン相当の状態が submitting になり、連続して押しても二重送信しない', async () => {
    const pending = deferred<AuthCallResult>()
    const requestReset = vi.fn(() => pending.promise)
    const controller = new ForgotPasswordController({ requestReset })
    controller.setEmail('user@example.com')

    const first = controller.submit()
    expect(controller.getSnapshot().status).toBe('submitting')
    const second = controller.submit()
    const third = controller.submit()
    await Promise.all([second, third])
    expect(requestReset).toHaveBeenCalledTimes(1)

    pending.resolve(OK)
    await first
    expect(controller.getSnapshot().status).toBe('sent')
    expect(requestReset).toHaveBeenCalledTimes(1)
  })

  it('送信中は入力を変更できない。送信後の再送信も、入力に戻るまではできない', async () => {
    const pending = deferred<AuthCallResult>()
    const controller = new ForgotPasswordController({ requestReset: vi.fn(() => pending.promise) })
    controller.setEmail('user@example.com')
    const submitting = controller.submit()
    controller.setEmail('other@example.com')
    expect(controller.getSnapshot().email).toBe('user@example.com')
    pending.resolve(OK)
    await submitting

    const requestReset = vi.fn(async () => OK)
    const again = new ForgotPasswordController({ requestReset })
    again.setEmail('user@example.com')
    await again.submit()
    await again.submit() // 送信済みの状態では何もしない
    expect(requestReset).toHaveBeenCalledTimes(1)
    again.backToForm()
    expect(again.getSnapshot().status).toBe('idle')
  })

  it('登録済みでも未登録でも、表示は同じ（アカウントの存在を推測できない）。送信先も表示しない', async () => {
    // Supabase は未登録のメールアドレスでも成功を返す。画面側も区別しない。
    const registered = setup()
    const unregistered = setup()
    registered.controller.setEmail('registered@example.com')
    unregistered.controller.setEmail('nobody@example.org')
    await registered.controller.submit()
    await unregistered.controller.submit()

    const a = registered.controller.getSnapshot()
    const b = unregistered.controller.getSnapshot()
    expect({ ...a, email: '' }).toEqual({ ...b, email: '' })
    expect(FORGOT_SENT_MESSAGE).toContain('登録されているメールアドレスの場合')
    expect(FORGOT_SENT_MESSAGE).not.toMatch(/@|example/)
  })

  it('通信エラー → エラーを表示し、もう一度送信できる', async () => {
    let result: AuthCallResult = { error: { status: 0, name: 'AuthRetryableFetchError' } }
    const requestReset = vi.fn(async () => result)
    const controller = new ForgotPasswordController({ requestReset })
    controller.setEmail('user@example.com')
    await controller.submit()
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', errorMessage: FORGOT_NETWORK_MESSAGE })

    result = OK
    await controller.submit()
    expect(requestReset).toHaveBeenCalledTimes(2)
    expect(controller.getSnapshot().status).toBe('sent')
  })

  it('status が無いエラー（レスポンス前の失敗）も通信エラーとして扱う', async () => {
    const { controller } = setup({ error: {} })
    controller.setEmail('user@example.com')
    await controller.submit()
    expect(controller.getSnapshot().errorMessage).toBe(FORGOT_NETWORK_MESSAGE)
  })

  it.each([
    [{ status: 429, code: 'over_email_send_rate_limit' }],
    [{ status: 429 }],
    [{ code: 'over_request_rate_limit', status: 400 }],
  ])('送信制限（%j）→ 送信制限のエラーを表示する', async (error) => {
    const { controller } = setup({ error })
    controller.setEmail('user@example.com')
    await controller.submit()
    expect(controller.getSnapshot()).toMatchObject({ status: 'error', errorMessage: FORGOT_RATE_LIMIT_MESSAGE })
  })

  it('サーバー側の失敗 → 一般的なエラー（原因の詳細は出さない）', async () => {
    const { controller } = setup({ error: { status: 500, code: 'unexpected_failure' } })
    controller.setEmail('user@example.com')
    await controller.submit()
    expect(controller.getSnapshot().errorMessage).toBe(FORGOT_FAILED_MESSAGE)
  })

  it('ログにも画面の状態のエラー文にも、送信先のメールアドレスを出さない', async () => {
    const { controller } = setup({ error: { status: 500, code: 'unexpected_failure' } })
    controller.setEmail('secret.person@example.com')
    await controller.submit()
    expectNoSecretsLogged('secret.person', 'example.com')
    expect(controller.getSnapshot().errorMessage).not.toContain('secret.person')
  })

  it('購読者へ状態の変化が通知される（画面が更新される）', async () => {
    const { controller } = setup()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.setEmail('user@example.com')
    await controller.submit()
    expect(listener).toHaveBeenCalled()
  })
})

describe('新しいパスワードの設定（ResetPasswordController）', () => {
  function setup(
    options: {
      isRecovery?: boolean
      urlError?: ResetPasswordDeps['urlError']
      mayBeRecovery?: boolean
      update?: () => Promise<AuthCallResult>
    } = {},
  ) {
    const recovery = createRecoveryState()
    if (options.isRecovery ?? true) recovery.markRecovery()
    const updatePassword = vi.fn(options.update ?? (async () => OK))
    const signOutRecoveredSession = vi.fn(async () => {})
    const controller = new ResetPasswordController({
      recovery,
      urlError: options.urlError ?? null,
      mayBeRecovery: options.mayBeRecovery ?? true,
      updatePassword,
      signOutRecoveredSession,
    })
    return { controller, recovery, updatePassword, signOutRecoveredSession }
  }

  const fill = (c: ResetPasswordController, password = 'newPassword1', confirm = password) => {
    c.setPassword(password)
    c.setConfirm(confirm)
  }

  describe('Recovery セッションの確認', () => {
    it('有効な Recovery セッション（PASSWORD_RECOVERY を受け取った）→ 入力できる', () => {
      const { controller } = setup({ isRecovery: true })
      expect(controller.getSnapshot().phase).toBe('ready')
    })

    it('通常のログインセッションだけ（PASSWORD_RECOVERY なし・リンクから来ていない）→ 入力できず、更新も呼ばない', async () => {
      const { controller, updatePassword } = setup({ isRecovery: false, mayBeRecovery: false })
      expect(controller.getSnapshot().phase).toBe('invalid')

      // 画面の外から直接 submit されても、updateUser は呼ばない
      fillDirect(controller)
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
      expect(controller.getSnapshot().phase).toBe('invalid')
    })

    it('Recovery セッションなし（セッション自体が無い）→ updateUser を呼ばない', async () => {
      const { controller, updatePassword } = setup({ isRecovery: false, mayBeRecovery: false })
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('再設定リンクから戻った直後は「確認中」。PASSWORD_RECOVERY が届いたら入力できるようになる', () => {
      const { controller, recovery } = setup({ isRecovery: false, mayBeRecovery: true })
      const stop = controller.start()
      expect(controller.getSnapshot().phase).toBe('checking')
      recovery.markRecovery()
      expect(controller.getSnapshot().phase).toBe('ready')
      stop()
    })

    it('確認中に PASSWORD_RECOVERY が届かないまま待ち時間を過ぎたら「リンクを確認できない」にする', async () => {
      const { controller, updatePassword } = setup({ isRecovery: false, mayBeRecovery: true })
      expect(controller.getSnapshot().phase).toBe('checking')
      controller.waitTimeout()
      expect(controller.getSnapshot().phase).toBe('invalid')
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('期限切れのリンク（URLに otp_expired）→ expired。Recovery があるように見えても入力させない', async () => {
      const { controller, updatePassword } = setup({ isRecovery: true, urlError: 'expired' })
      expect(controller.getSnapshot().phase).toBe('expired')
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
    })

    it('不正なリンク（期限切れ以外のエラー）→ invalid', () => {
      const { controller } = setup({ isRecovery: false, urlError: 'invalid', mayBeRecovery: false })
      expect(controller.getSnapshot().phase).toBe('invalid')
    })

    it('入力できる状態から Recovery が解除されたら（サインアウト等）、更新を呼ばずに無効な状態へ戻る', async () => {
      const { controller, recovery, updatePassword } = setup()
      const stop = controller.start()
      fill(controller)
      recovery.clear()
      expect(controller.getSnapshot().phase).toBe('invalid')
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
      stop()
    })

    /** 状態が ready でないときの直接入力（画面は入力欄を出さないが、念のため呼べないことを確認する） */
    function fillDirect(c: ResetPasswordController) {
      c.setPassword('newPassword1')
      c.setConfirm('newPassword1')
    }
  })

  describe('入力の検証', () => {
    it('パスワードが一致しない → 更新を呼ばず、確認欄にエラーを表示する', async () => {
      const { controller, updatePassword } = setup()
      fill(controller, 'newPassword1', 'newPassword2')
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
      expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', confirmError: RESET_PASSWORD_MISMATCH_MESSAGE })
    })

    it('8文字未満（既存のパスワード条件）→ 更新を呼ばず、エラーを表示する', async () => {
      const { controller, updatePassword } = setup()
      fill(controller, '1234567')
      await controller.submit()
      expect(updatePassword).not.toHaveBeenCalled()
      expect(controller.getSnapshot().passwordError).toBe('パスワードは8文字以上で入力してください')
    })

    it('8文字ちょうどなら更新できる', async () => {
      const { controller, updatePassword } = setup()
      fill(controller, '12345678')
      await controller.submit()
      expect(updatePassword).toHaveBeenCalledWith('12345678')
    })

    it('入力しているうちに、前回のエラーは消える', async () => {
      const { controller } = setup()
      fill(controller, 'short', 'short')
      await controller.submit()
      expect(controller.getSnapshot().passwordError).not.toBeNull()
      controller.setPassword('longEnough1')
      expect(controller.getSnapshot().passwordError).toBeNull()
    })
  })

  describe('更新', () => {
    it('更新成功 → 完了。再設定に使ったセッションをこの端末だけ終了し、Recovery を解除し、入力を消す', async () => {
      const { controller, updatePassword, signOutRecoveredSession, recovery } = setup()
      fill(controller)
      await controller.submit()

      expect(updatePassword).toHaveBeenCalledTimes(1)
      expect(updatePassword).toHaveBeenCalledWith('newPassword1')
      expect(signOutRecoveredSession).toHaveBeenCalledTimes(1)
      expect(recovery.isRecovery()).toBe(false)
      expect(controller.getSnapshot()).toMatchObject({ phase: 'done', password: '', confirm: '' })
    })

    it('完了後にもう一度送信しても、更新を呼ばない', async () => {
      const { controller, updatePassword } = setup()
      fill(controller)
      await controller.submit()
      await controller.submit()
      expect(updatePassword).toHaveBeenCalledTimes(1)
    })

    it('二重送信の防止：更新中に何度押しても updateUser は1回だけ', async () => {
      const pending = deferred<AuthCallResult>()
      const { controller, updatePassword } = setup({ update: () => pending.promise })
      fill(controller)
      const first = controller.submit()
      expect(controller.getSnapshot().phase).toBe('submitting')
      await Promise.all([controller.submit(), controller.submit()])
      expect(updatePassword).toHaveBeenCalledTimes(1)

      pending.resolve(OK)
      await first
      expect(controller.getSnapshot().phase).toBe('done')
      expect(updatePassword).toHaveBeenCalledTimes(1)
    })

    it('更新中は入力を変更できない', async () => {
      const pending = deferred<AuthCallResult>()
      const { controller } = setup({ update: () => pending.promise })
      fill(controller)
      const submitting = controller.submit()
      controller.setPassword('changedWhileSubmitting')
      expect(controller.getSnapshot().password).toBe('newPassword1')
      pending.resolve(OK)
      await submitting
    })

    it('更新失敗（一般）→ エラーを表示し、入力を残して再試行できる', async () => {
      let result: AuthCallResult = { error: { status: 500, code: 'unexpected_failure' } }
      const { controller, updatePassword } = setup({ update: async () => result })
      fill(controller)
      await controller.submit()
      expect(controller.getSnapshot()).toMatchObject({
        phase: 'ready',
        errorMessage: RESET_FAILED_MESSAGE,
        password: 'newPassword1',
      })

      result = OK
      await controller.submit()
      expect(updatePassword).toHaveBeenCalledTimes(2)
      expect(controller.getSnapshot().phase).toBe('done')
    })

    it('通信エラー → 通信エラーを表示し、再試行できる', async () => {
      const { controller } = setup({ update: async () => ({ error: { status: 0, name: 'AuthRetryableFetchError' } }) })
      fill(controller)
      await controller.submit()
      expect(controller.getSnapshot()).toMatchObject({ phase: 'ready', errorMessage: RESET_NETWORK_MESSAGE })
    })

    it('現在と同じパスワード / 強度不足 → 専用のエラーを表示する', async () => {
      const same = setup({ update: async () => ({ error: { status: 422, code: 'same_password' } }) })
      fill(same.controller)
      await same.controller.submit()
      expect(same.controller.getSnapshot().errorMessage).toBe(RESET_SAME_PASSWORD_MESSAGE)

      const weak = setup({ update: async () => ({ error: { status: 422, code: 'weak_password' } }) })
      fill(weak.controller)
      await weak.controller.submit()
      expect(weak.controller.getSnapshot().errorMessage).toBe(RESET_WEAK_PASSWORD_MESSAGE)
    })

    it.each([
      [{ status: 401, code: 'bad_jwt' }],
      [{ status: 400, name: 'AuthSessionMissingError' }],
      [{ status: 403, code: 'session_expired' }],
      [{ code: 'otp_expired', status: 400 }],
    ])('更新時にセッションが失効していた（%j）→ 期限切れとして扱い、Recovery を解除する', async (error) => {
      const { controller, recovery, signOutRecoveredSession } = setup({ update: async () => ({ error }) })
      fill(controller)
      await controller.submit()
      expect(controller.getSnapshot().phase).toBe('expired')
      expect(controller.getSnapshot().password).toBe('')
      expect(recovery.isRecovery()).toBe(false)
      expect(signOutRecoveredSession).not.toHaveBeenCalled()
    })

    it('ログにパスワード・トークンを出さない（失敗時は status と code だけ）', async () => {
      const { controller } = setup({ update: async () => ({ error: { status: 500, code: 'unexpected_failure' } }) })
      fill(controller, 'MyS3cretPassw0rd')
      await controller.submit()
      expectNoSecretsLogged('MyS3cretPassw0rd')
      expect(errorLog.mock.calls[0]?.[1]).toEqual({ status: 500, code: 'unexpected_failure' })
    })
  })
})
