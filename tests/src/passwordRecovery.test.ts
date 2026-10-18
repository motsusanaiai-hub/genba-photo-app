import { describe, expect, it, vi } from 'vitest'
import {
  buildPasswordResetRedirectUrl,
  createRecoveryState,
  parseAuthUrlState,
  watchPasswordRecovery,
  type AuthEventSource,
} from '@/lib/passwordRecovery'

// パスワード再設定の部品（外部サービスには接続しない）。

describe('buildPasswordResetRedirectUrl（redirectTo は信頼できる origin からだけ作る）', () => {
  it.each([
    ['本番・Vercel Preview（https）', 'https://genba-photo-app.vercel.app', 'https://genba-photo-app.vercel.app/reset-password'],
    ['Preview のデプロイURL', 'https://genba-photo-3tnlnk3e5-team.vercel.app', 'https://genba-photo-3tnlnk3e5-team.vercel.app/reset-password'],
    ['独自ドメイン', 'https://app.example.jp', 'https://app.example.jp/reset-password'],
    ['localhost（開発）', 'http://localhost:5173', 'http://localhost:5173/reset-password'],
    ['127.0.0.1（開発）', 'http://127.0.0.1:3000', 'http://127.0.0.1:3000/reset-password'],
    ['末尾スラッシュ付き', 'https://app.example.jp/', 'https://app.example.jp/reset-password'],
  ])('%s', (_label, origin, expected) => {
    expect(buildPasswordResetRedirectUrl(origin)).toBe(expected)
  })

  it.each([
    ['localhost 以外の http', 'http://evil.example'],
    ['http の本番風ドメイン', 'http://genba-photo-app.vercel.app'],
    ['認証情報つき', 'https://user:pass@app.example.jp'],
    ['パス付き', 'https://app.example.jp/path'],
    ['クエリ付き', 'https://app.example.jp?x=1'],
    ['ハッシュ付き', 'https://app.example.jp/#x'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,hi'],
    ['URLでない文字列', 'not a url'],
    ['空文字', ''],
    ['null', null],
    ['undefined', undefined],
  ])('信頼できない値は使わない（%s → null。redirectTo は付けない）', (_label, origin) => {
    expect(buildPasswordResetRedirectUrl(origin as string | null | undefined)).toBeNull()
  })
})

describe('parseAuthUrlState（URLの分類だけを読む。値は読まない）', () => {
  it('implicit フローの再設定リンク（#access_token=…&type=recovery）→ 再設定の可能性あり', () => {
    expect(parseAuthUrlState('#access_token=SECRET&refresh_token=SECRET2&type=recovery', '')).toEqual({
      error: null,
      mayBeRecovery: true,
    })
  })

  it('PKCE フロー（?code=…）→ 再設定の可能性あり', () => {
    expect(parseAuthUrlState('', '?code=SECRETCODE')).toEqual({ error: null, mayBeRecovery: true })
  })

  it('期限切れのリンク（error_code=otp_expired）→ expired', () => {
    expect(
      parseAuthUrlState('#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', ''),
    ).toEqual({ error: 'expired', mayBeRecovery: false })
  })

  it('説明文に expired を含むエラー → expired', () => {
    expect(parseAuthUrlState('#error=access_denied&error_description=link+has+expired', '')).toMatchObject({ error: 'expired' })
  })

  it('それ以外のエラー付きURL → invalid', () => {
    expect(parseAuthUrlState('#error=server_error&error_code=unexpected_failure', '')).toEqual({
      error: 'invalid',
      mayBeRecovery: false,
    })
    expect(parseAuthUrlState('', '?error=access_denied')).toMatchObject({ error: 'invalid' })
  })

  it('認証と無関係なURL、他の種類のリンク（type=signup）→ 再設定の可能性なし', () => {
    expect(parseAuthUrlState('', '')).toEqual({ error: null, mayBeRecovery: false })
    expect(parseAuthUrlState('#access_token=x&type=signup', '')).toEqual({ error: null, mayBeRecovery: false })
    expect(parseAuthUrlState('#section', '?utm=1')).toEqual({ error: null, mayBeRecovery: false })
  })

  it('戻り値にトークン・コード・エラー文の値を含めない', () => {
    const results = [
      parseAuthUrlState('#access_token=TOKEN123&refresh_token=REFRESH456&type=recovery', ''),
      parseAuthUrlState('', '?code=CODE789'),
      parseAuthUrlState('#error_description=DESC999&error_code=otp_expired', ''),
    ]
    const text = JSON.stringify(results)
    for (const secret of ['TOKEN123', 'REFRESH456', 'CODE789', 'DESC999']) expect(text).not.toContain(secret)
  })
})

describe('Recovery の状態（メモリのみ）', () => {
  it('最初は Recovery ではなく、markRecovery で Recovery になり、clear で解除される', () => {
    const state = createRecoveryState()
    expect(state.isRecovery()).toBe(false)
    state.markRecovery()
    expect(state.isRecovery()).toBe(true)
    state.clear()
    expect(state.isRecovery()).toBe(false)
  })

  it('変化したときだけ購読者へ通知し、購読解除後は通知しない', () => {
    const state = createRecoveryState()
    const listener = vi.fn()
    const unsubscribe = state.subscribe(listener)
    state.markRecovery()
    state.markRecovery() // 変化なし
    expect(listener).toHaveBeenCalledTimes(1)
    state.clear()
    state.clear() // 変化なし
    expect(listener).toHaveBeenCalledTimes(2)
    unsubscribe()
    state.markRecovery()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('localStorage / sessionStorage に保存しない（ソースに保存処理がない）', async () => {
    const { readFileSync } = await import('node:fs')
    const path = await import('node:path')
    const source = readFileSync(path.resolve(__dirname, '../../src/lib/passwordRecovery.ts'), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
  })
})

describe('watchPasswordRecovery（Supabase Auth のイベント監視）', () => {
  function fakeAuth() {
    let callback: ((event: string, session: unknown) => void) | undefined
    const unsubscribe = vi.fn()
    const auth: AuthEventSource = {
      onAuthStateChange(cb) {
        callback = cb
        return { data: { subscription: { unsubscribe } } }
      },
    }
    return { auth, emit: (event: string) => callback?.(event, { access_token: 'SECRET' }), unsubscribe }
  }

  it('PASSWORD_RECOVERY を受け取ると Recovery になる', () => {
    const { auth, emit } = fakeAuth()
    const state = createRecoveryState()
    watchPasswordRecovery(auth, state)
    emit('PASSWORD_RECOVERY')
    expect(state.isRecovery()).toBe(true)
  })

  it.each(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED', 'USER_UPDATED'])(
    '通常のログインのイベント（%s）だけでは Recovery にならない',
    (event) => {
      const { auth, emit } = fakeAuth()
      const state = createRecoveryState()
      watchPasswordRecovery(auth, state)
      emit(event)
      expect(state.isRecovery()).toBe(false)
    },
  )

  it('Recovery の後に SIGNED_IN が来ても Recovery は維持され、SIGNED_OUT で解除される', () => {
    const { auth, emit } = fakeAuth()
    const state = createRecoveryState()
    watchPasswordRecovery(auth, state)
    emit('PASSWORD_RECOVERY')
    emit('SIGNED_IN')
    emit('TOKEN_REFRESHED')
    expect(state.isRecovery()).toBe(true)
    emit('SIGNED_OUT')
    expect(state.isRecovery()).toBe(false)
  })

  it('監視はクライアント作成直後に同期的に登録される（初期化直後の通知を取りこぼさない）', () => {
    const onAuthStateChange = vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } }))
    watchPasswordRecovery({ onAuthStateChange }, createRecoveryState())
    expect(onAuthStateChange).toHaveBeenCalledTimes(1)
  })

  it('戻り値の関数で監視を解除できる', () => {
    const { auth, unsubscribe } = fakeAuth()
    const stop = watchPasswordRecovery(auth, createRecoveryState())
    stop()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
})
