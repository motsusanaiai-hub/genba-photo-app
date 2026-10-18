import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// パスワード再設定の画面（表示）と、既存の認証画面・AuthGuard・ルートへの影響。
// Supabase はモック（外部サービスには接続しない）。ログイン画面の「パスワードを忘れた方」は、
// Supabase が設定されている環境でだけ表示されるため、設定済みとして扱う。

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: {} },
  isSupabaseConfigured: true,
  authMode: 'supabase',
}))

// zustand のフックは、サーバー描画では初期状態しか返さない。AuthGuard の動作を確認できるよう、
// 「実際の zustand ストア ＋ 現在の状態を読むフック」に差し替える（adSlot.test.ts と同じ方法）。
vi.mock('@/store/authStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<{
    user: unknown
    initialized: boolean
    setUser: (user: unknown) => void
    setInitialized: (initialized: boolean) => void
  }>((set) => ({
    user: null,
    initialized: false,
    setUser: (user) => set({ user }),
    setInitialized: (initialized) => set({ initialized }),
  }))
  const useAuthStore = Object.assign(
    <T>(selector?: (s: ReturnType<typeof store.getState>) => T) => (selector ? selector(store.getState()) : store.getState()),
    store,
  )
  return { useAuthStore }
})

import { AuthGuard } from '@/components/auth/AuthGuard'
import { AuthLayout } from '@/components/layout/AuthLayout'
import { ForgotPasswordPage, ForgotPasswordView } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordPage, ResetPasswordView } from '@/pages/auth/ResetPasswordPage'
import { LoginPage } from '@/pages/auth/LoginPage'
import { SignupPage } from '@/pages/auth/SignupPage'
import { TermsPage } from '@/pages/legal/TermsPage'
import { PrivacyPage } from '@/pages/legal/PrivacyPage'
import { useAuthStore } from '@/store/authStore'
import {
  FORGOT_NETWORK_MESSAGE,
  FORGOT_SENT_MESSAGE,
  type ForgotPasswordState,
  type ResetPasswordState,
} from '@/lib/passwordRecoveryControllers'

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const render = (element: ReactElement) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] }, element))
const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, '')
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag)
const noop = () => {}

const forgotState = (overrides: Partial<ForgotPasswordState> = {}): ForgotPasswordState => ({
  email: '',
  status: 'idle',
  fieldError: null,
  errorMessage: null,
  ...overrides,
})
const resetState = (overrides: Partial<ResetPasswordState> = {}): ResetPasswordState => ({
  phase: 'ready',
  password: '',
  confirm: '',
  passwordError: null,
  confirmError: null,
  errorMessage: null,
  ...overrides,
})
const forgotView = (state: ForgotPasswordState) =>
  render(createElement(ForgotPasswordView, { state, onEmailChange: noop, onSubmit: noop, onBackToForm: noop }))
const resetView = (state: ResetPasswordState) =>
  render(createElement(ResetPasswordView, { state, onPasswordChange: noop, onConfirmChange: noop, onSubmit: noop }))

beforeEach(() => {
  useAuthStore.setState({ user: null, initialized: true })
})

describe('メール送信画面', () => {
  it('入力画面：メール欄（type=email・スマホ向けの入力種別）、送信ボタン、ログインへ戻るリンクがある', () => {
    const html = forgotView(forgotState())
    expect(html).toMatch(/<input[^>]*type="email"[^>]*>/)
    expect(html).toMatch(/autoComplete="email"|autocomplete="email"/i)
    expect(html).toMatch(/inputMode="email"|inputmode="email"/i)
    expect(html).toContain('再設定のご案内を送る')
    expect(html).toMatch(/<a [^>]*href="\/auth\/login"/)
    const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? ''
    expect(isDisabled(button)).toBe(false)
  })

  it('送信中：ボタンと入力欄が無効になる（二重送信できない）', () => {
    const html = forgotView(forgotState({ status: 'submitting', email: 'user@example.com' }))
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(true)
    expect(isDisabled(html.match(/<input[^>]*type="email"[^>]*>/)?.[0] ?? '')).toBe(true)
    expect(html).toContain('送信中')
  })

  it('メール形式のエラーは入力欄の下に表示される', () => {
    const html = forgotView(forgotState({ fieldError: '有効なメールアドレスを入力してください' }))
    expect(html).toContain('有効なメールアドレスを入力してください')
    expect(html).toContain('aria-invalid="true"')
  })

  it('送信後：「登録されているメールアドレスの場合」の案内を表示し、送信先のメールアドレスは表示しない', () => {
    const html = forgotView(forgotState({ status: 'sent', email: 'secret.person@example.com' }))
    const text = textOf(html)
    expect(text).toContain(textOf(FORGOT_SENT_MESSAGE))
    expect(text).toContain('登録されているメールアドレスの場合、パスワード再設定のご案内を送信します')
    expect(html).not.toContain('secret.person')
    expect(html).not.toContain('<input')
    expect(html).toMatch(/<a [^>]*href="\/auth\/login"/)
  })

  it('登録済みでも未登録でも、送信後の画面は同じ（アカウントの存在を推測できない）', () => {
    const a = forgotView(forgotState({ status: 'sent', email: 'registered@example.com' }))
    const b = forgotView(forgotState({ status: 'sent', email: 'unknown@example.org' }))
    expect(a).toBe(b)
  })

  it('送信処理が失敗したときは、エラーを表示する（入力画面のまま、再送できる）', () => {
    const html = forgotView(forgotState({ status: 'error', errorMessage: FORGOT_NETWORK_MESSAGE }))
    expect(textOf(html)).toContain(textOf(FORGOT_NETWORK_MESSAGE))
    expect(html).toMatch(/role="alert"/)
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(false)
  })

  it('ページ本体（ForgotPasswordPage）を描画できる（未ログインでも）', () => {
    const html = render(createElement(ForgotPasswordPage))
    expect(html).toContain('パスワードを再設定')
  })
})

describe('新しいパスワードの設定画面', () => {
  it('入力画面：2つのパスワード欄（new-password）と、変更ボタン', () => {
    const html = resetView(resetState())
    expect(html.match(/<input[^>]*type="password"[^>]*>/g)).toHaveLength(2)
    expect(html.match(/autoComplete="new-password"|autocomplete="new-password"/g)).toHaveLength(2)
    expect(html).toContain('パスワードを変更')
    expect(html).toContain('8文字以上')
  })

  it('変更中：ボタンと入力欄が無効になる', () => {
    const html = resetView(resetState({ phase: 'submitting', password: 'newPassword1', confirm: 'newPassword1' }))
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(true)
    for (const input of html.match(/<input[^>]*type="password"[^>]*>/g) ?? []) expect(isDisabled(input)).toBe(true)
  })

  it('検証エラー（不一致・8文字未満）と更新エラーを表示する', () => {
    const html = resetView(
      resetState({
        passwordError: 'パスワードは8文字以上で入力してください',
        confirmError: '確認用のパスワードが一致しません',
        errorMessage: 'パスワードを変更できませんでした。もう一度お試しください。',
      }),
    )
    expect(html).toContain('パスワードは8文字以上で入力してください')
    expect(html).toContain('確認用のパスワードが一致しません')
    expect(html).toContain('パスワードを変更できませんでした')
  })

  it('確認中：スピナー付きの案内だけで、入力欄は出ない', () => {
    const html = resetView(resetState({ phase: 'checking' }))
    expect(html).toContain('再設定のリンクを確認しています')
    expect(html).not.toContain('<input')
  })

  it('期限切れ：期限切れの案内と、もう一度送るリンク・ログインへ戻るリンク。入力欄は出ない', () => {
    const html = resetView(resetState({ phase: 'expired' }))
    expect(html).toContain('有効期限が切れています')
    expect(html).not.toContain('<input')
    expect(html).toMatch(/<a [^>]*href="\/auth\/forgot-password"/)
    expect(html).toMatch(/<a [^>]*href="\/auth\/login"/)
  })

  it('不正なリンク：案内と導線。入力欄は出ない', () => {
    const html = resetView(resetState({ phase: 'invalid' }))
    expect(html).toContain('再設定のリンクを確認できませんでした')
    expect(html).not.toContain('<input')
    expect(html).toMatch(/<a [^>]*href="\/auth\/forgot-password"/)
  })

  it('更新成功：完了の案内と、ログイン画面への導線', () => {
    const html = resetView(resetState({ phase: 'done' }))
    expect(html).toContain('パスワードを変更しました')
    expect(html).toMatch(/<a [^>]*href="\/auth\/login"/)
    expect(html).not.toContain('<input')
  })

  it('通常のログインセッションだけ（Recovery なし）で /reset-password を開いても、入力欄は出ない', () => {
    useAuthStore.setState({
      user: { id: 'user-1', email: 'user@example.com', display_name: 'user', plan: 'free' },
      initialized: true,
    })
    const html = render(createElement(ResetPasswordPage))
    expect(html).toContain('再設定のリンクを確認できませんでした')
    expect(html).not.toContain('type="password"')
  })

  it('未ログインで /reset-password を直接開いても、入力欄は出ない（リンクが無い場合）', () => {
    const html = render(createElement(ResetPasswordPage))
    expect(html).not.toContain('type="password"')
  })
})

describe('既存の認証画面・AuthGuard・ルートへの影響', () => {
  it('ログイン画面：メール・パスワードの入力とログインボタンは従来どおり。「パスワードを忘れた方」が押せるリンクになった', () => {
    const html = render(createElement(LoginPage))
    expect(html).toMatch(/<input[^>]*type="email"/)
    expect(html).toMatch(/<input[^>]*type="password"/)
    expect(html).not.toContain('type="checkbox"')
    expect(html).toMatch(/<a [^>]*href="\/auth\/forgot-password"[^>]*>[^<]*パスワードを忘れた方/)
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(false)
    expect(read('src/pages/auth/LoginPage.tsx')).toContain('signIn(values.email, values.password)')
  })

  it('新規登録画面：同意チェックが従来どおり必要（登録ボタンは初期状態で押せない）', () => {
    const html = render(createElement(SignupPage))
    expect(html).toContain('type="checkbox"')
    expect(isDisabled(html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? '')).toBe(true)
  })

  it('AuthGuard：未ログインは通さず、ログイン済みは通す。初期化前はスピナー（従来どおり）', () => {
    const guard = () => render(createElement(AuthGuard, null, createElement('p', null, 'PROTECTED')))
    useAuthStore.setState({ user: null, initialized: false })
    expect(guard()).toContain('animate-spin')
    expect(guard()).not.toContain('PROTECTED')

    useAuthStore.setState({ user: null, initialized: true })
    expect(guard()).not.toContain('PROTECTED')

    useAuthStore.setState({
      user: { id: 'u', email: 'u@example.com', display_name: 'u', plan: 'free' },
      initialized: true,
    })
    expect(guard()).toContain('PROTECTED')
  })

  it('AuthGuard と useAuth は、このSTEPで変更していない（Recovery は別の部品で扱う）', () => {
    for (const file of ['src/components/auth/AuthGuard.tsx', 'src/hooks/useAuth.ts']) {
      expect(read(file)).not.toMatch(/recovery|reset-password|PASSWORD_RECOVERY|passwordRecovery/i)
    }
  })

  it('ルート：/reset-password と /auth/forgot-password は AuthGuard の外（ログイン不要）にある', () => {
    const router = read('src/router.tsx')
    const guard = router.indexOf('<AuthGuard>')
    const reset = router.indexOf("path: '/reset-password'")
    const forgot = router.indexOf("path: 'forgot-password'")
    const authGroup = router.indexOf("path: '/auth'")
    expect(reset).toBeGreaterThan(-1)
    expect(reset).toBeLessThan(guard)
    expect(forgot).toBeGreaterThan(authGroup)
    expect(forgot).toBeLessThan(guard)
    // 既存の公開ルートも維持
    for (const route of ["path: '/terms'", "path: '/privacy'", "path: 'login'", "path: 'signup'"]) {
      expect(router).toContain(route)
    }
  })

  it('利用規約・プライバシーポリシーは従来どおり表示できる', () => {
    expect(textOf(render(createElement(TermsPage)))).toContain('利用規約')
    expect(textOf(render(createElement(PrivacyPage)))).toContain('プライバシーポリシー')
  })

  it('共通レイアウト（ログイン・登録・再設定の画面）に規約リンクがある', () => {
    const html = render(createElement(AuthLayout))
    expect(html).toContain('href="/terms"')
    expect(html).toContain('href="/privacy"')
  })
})

describe('セキュリティ（新しいファイル）', () => {
  const files = [
    'src/lib/passwordRecovery.ts',
    'src/lib/passwordRecoveryControllers.ts',
    'src/lib/authRecoveryApi.ts',
    'src/pages/auth/ForgotPasswordPage.tsx',
    'src/pages/auth/ResetPasswordPage.tsx',
  ]
  const code = (file: string) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')

  it('トークン・パスワードを保存しない（localStorage / sessionStorage / IndexedDB / cookie を使わない）', () => {
    for (const file of files) expect(code(file)).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
  })

  it('URLの認証情報・パスワード・メールアドレスをログに出さない（console は status と code だけ）', () => {
    for (const file of files) {
      const calls = code(file).match(/console\.\w+\([^)]*\)/g) ?? []
      for (const call of calls) {
        // 先頭の固定のラベル（例: '[password-reset] send failed'）は除き、渡している値を確認する
        const values = call.replace(/^console\.\w+\(\s*'[^']*'\s*,?/, '')
        expect(values).not.toMatch(/location|hash|search|href|password|email|token|session/i)
      }
      expect(code(file)).not.toMatch(/console\.(log|info|debug)/)
    }
  })

  it('独自の認証・トークン検証をしていない（Supabase Auth の標準機能だけを使う）', () => {
    const api = code('src/lib/authRecoveryApi.ts')
    expect(api).toMatch(/resetPasswordForEmail/)
    expect(api).toMatch(/updateUser\(\{ password \}\)/)
    expect(api).not.toMatch(/verifyOtp|setSession|exchangeCodeForSession|jwt|fetch\(/i)
    expect(code('src/lib/passwordRecovery.ts')).not.toMatch(/atob|jwt|decode|verify/i)
  })

  it('redirectTo は window.location.origin（信頼できる形のときだけ）から作り、画面の入力は使わない', () => {
    const api = code('src/lib/authRecoveryApi.ts')
    expect(api).toContain('window.location.origin')
    expect(api).toContain('buildPasswordResetRedirectUrl(origin)')
    expect(api).not.toMatch(/redirectTo:\s*(email|input|value|params|search)/)
  })
})
