import { beforeEach, describe, expect, it, vi } from 'vitest'

// Supabase Auth の呼び出し（再設定専用の薄い層）。Supabase クライアントはモック（外部サービスには接続しない）。

const mocks = vi.hoisted(() => ({
  mode: 'supabase' as 'supabase' | 'mock' | 'misconfigured',
  hasClient: true,
  auth: {
    resetPasswordForEmail: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
  },
}))

vi.mock('@/lib/supabase', () => ({
  get supabase() {
    return mocks.hasClient ? { auth: mocks.auth } : null
  },
  get authMode() {
    return mocks.mode
  },
}))

import { requestPasswordResetEmail, signOutRecoveredSession, updateRecoveredPassword } from '@/lib/authRecoveryApi'

beforeEach(() => {
  mocks.mode = 'supabase'
  mocks.hasClient = true
  vi.clearAllMocks()
  mocks.auth.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })
  mocks.auth.updateUser.mockResolvedValue({ data: {}, error: null })
  mocks.auth.signOut.mockResolvedValue({ error: null })
})

describe('requestPasswordResetEmail', () => {
  it('Supabase Auth の標準機能（resetPasswordForEmail）で送信し、リンク先は /reset-password にする', async () => {
    const result = await requestPasswordResetEmail('user@example.com', 'https://genba-photo-xxxx.vercel.app')
    expect(result).toEqual({ error: null })
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledTimes(1)
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: 'https://genba-photo-xxxx.vercel.app/reset-password',
    })
  })

  it('localhost（開発）でも同じ構成のリンク先になる', async () => {
    await requestPasswordResetEmail('user@example.com', 'http://localhost:5173')
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', {
      redirectTo: 'http://localhost:5173/reset-password',
    })
  })

  it.each([
    ['localhost 以外の http', 'http://evil.example'],
    ['認証情報つき', 'https://a:b@app.example.jp'],
    ['URLでない', 'javascript:alert(1)'],
    ['origin を取得できない', null],
  ])('信頼できない origin（%s）では redirectTo を付けない（Supabase の Site URL に戻る）', async (_label, origin) => {
    await requestPasswordResetEmail('user@example.com', origin)
    expect(mocks.auth.resetPasswordForEmail).toHaveBeenCalledWith('user@example.com', undefined)
  })

  it('redirectTo に使うのは origin だけで、メールアドレスなど利用者の入力は含まれない', async () => {
    await requestPasswordResetEmail('https://evil.example/@x.com', 'https://app.example.jp')
    const options = mocks.auth.resetPasswordForEmail.mock.calls[0][1] as { redirectTo: string }
    expect(options.redirectTo).toBe('https://app.example.jp/reset-password')
    expect(options.redirectTo).not.toContain('evil')
  })

  it('エラーは status / code / name だけに絞って返す（エラー文・メールアドレスは持ち出さない）', async () => {
    mocks.auth.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', status: 429, code: 'over_email_send_rate_limit', message: 'rate limit for user@example.com' },
    })
    const result = await requestPasswordResetEmail('user@example.com', 'https://app.example.jp')
    expect(result.error).toEqual({ status: 429, code: 'over_email_send_rate_limit', name: 'AuthApiError' })
    expect(JSON.stringify(result)).not.toContain('user@example.com')
  })

  it('通信の例外は、status の無いエラーとして返す（例外を投げない）', async () => {
    mocks.auth.resetPasswordForEmail.mockRejectedValue(new TypeError('fetch failed'))
    const result = await requestPasswordResetEmail('user@example.com', 'https://app.example.jp')
    expect(result.error).toEqual({ status: undefined, code: undefined, name: 'TypeError' })
  })

  it('開発モード（Supabase 未設定）ではメールを送らず、成功扱い', async () => {
    mocks.mode = 'mock'
    const result = await requestPasswordResetEmail('user@example.com')
    expect(result).toEqual({ error: null })
    expect(mocks.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })

  it('本番ビルドで設定が不足している場合は送らず、エラーを返す', async () => {
    mocks.mode = 'misconfigured'
    const result = await requestPasswordResetEmail('user@example.com')
    expect(result.error).toMatchObject({ status: 503 })
    expect(mocks.auth.resetPasswordForEmail).not.toHaveBeenCalled()
  })
})

describe('updateRecoveredPassword / signOutRecoveredSession', () => {
  it('updateUser({ password }) だけを呼ぶ（パスワードは自前のDB・保存先に渡さない）', async () => {
    const result = await updateRecoveredPassword('newPassword1')
    expect(result).toEqual({ error: null })
    expect(mocks.auth.updateUser).toHaveBeenCalledTimes(1)
    expect(mocks.auth.updateUser).toHaveBeenCalledWith({ password: 'newPassword1' })
  })

  it('更新エラーは status / code / name だけに絞って返す', async () => {
    mocks.auth.updateUser.mockResolvedValue({
      data: null,
      error: { name: 'AuthApiError', status: 422, code: 'same_password', message: 'New password should be different' },
    })
    const result = await updateRecoveredPassword('newPassword1')
    expect(result.error).toEqual({ status: 422, code: 'same_password', name: 'AuthApiError' })
  })

  it('開発モード・設定不足では更新しない', async () => {
    mocks.mode = 'mock'
    expect((await updateRecoveredPassword('newPassword1')).error).not.toBeNull()
    mocks.mode = 'misconfigured'
    expect((await updateRecoveredPassword('newPassword1')).error).not.toBeNull()
    expect(mocks.auth.updateUser).not.toHaveBeenCalled()
  })

  it('再設定に使ったセッションは、この端末だけ終了する（scope: local。他の端末のログインは終了しない）', async () => {
    await signOutRecoveredSession()
    expect(mocks.auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('サインアウトが失敗しても例外にしない', async () => {
    mocks.auth.signOut.mockRejectedValue(new Error('network'))
    await expect(signOutRecoveredSession()).resolves.toBeUndefined()
  })

  it('開発モードではサインアウトを呼ばない', async () => {
    mocks.mode = 'mock'
    await signOutRecoveredSession()
    expect(mocks.auth.signOut).not.toHaveBeenCalled()
  })
})
