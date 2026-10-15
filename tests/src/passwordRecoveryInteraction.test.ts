import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// パスワード再設定の画面を「操作」して確認するテスト。
// このプロジェクトには DOM 環境（jsdom 等）が無いため、実ブラウザのクリック・入力は再現できない。
// 代わりに、表示コンポーネント（ForgotPasswordView / ResetPasswordView）が返す要素ツリーから
// 入力欄・フォーム・ボタンを探し、画面が実際に持つ onChange / onSubmit / onClick を呼び出して操作する。
// コントローラー（二重送信の防止・検証・Recovery の確認）とつなげて、操作 → 再描画 → 表示の変化まで確認する。
// 実ブラウザでの確認は、後の staging 検証で行う。

vi.mock('@/lib/supabase', () => ({ supabase: { auth: {} }, isSupabaseConfigured: true, authMode: 'supabase' }))

import { ForgotPasswordView } from '@/pages/auth/ForgotPasswordPage'
import { ResetPasswordView } from '@/pages/auth/ResetPasswordPage'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createRecoveryState } from '@/lib/passwordRecovery'
import type { AuthCallResult } from '@/lib/authRecoveryApi'
import { ForgotPasswordController, ResetPasswordController } from '@/lib/passwordRecoveryControllers'

type AnyElement = ReactElement<Record<string, unknown>>

function walk(node: ReactNode, visit: (el: AnyElement) => void) {
  if (Array.isArray(node)) {
    node.forEach((child) => walk(child, visit))
  } else if (isValidElement(node)) {
    const el = node as AnyElement
    visit(el)
    walk(el.props.children as ReactNode, visit)
  }
}

function findAll(tree: ReactNode, predicate: (el: AnyElement) => boolean): AnyElement[] {
  const found: AnyElement[] = []
  walk(tree, (el) => {
    if (predicate(el)) found.push(el)
  })
  return found
}

function textOf(tree: ReactNode): string {
  let text = ''
  const collect = (node: ReactNode) => {
    if (typeof node === 'string' || typeof node === 'number') text += node
    else if (Array.isArray(node)) node.forEach(collect)
    else if (isValidElement(node)) collect((node as AnyElement).props.children as ReactNode)
  }
  collect(tree)
  return text.replace(/\s+/g, '')
}

const inputById = (tree: ReactNode, id: string) => findAll(tree, (el) => el.type === Input && el.props.id === id)[0]
const form = (tree: ReactNode) => findAll(tree, (el) => el.type === 'form')[0]
const submitButton = (tree: ReactNode) => findAll(tree, (el) => el.type === Button && el.props.type === 'submit')[0]

/** 入力欄に文字を入力する（画面の onChange を呼ぶ） */
function type(tree: ReactNode, id: string, value: string) {
  const input = inputById(tree, id)
  expect(input).toBeDefined()
  ;(input.props.onChange as (e: { target: { value: string } }) => void)({ target: { value } })
}

/** フォームを送信する（画面の onSubmit を呼ぶ。ブラウザの標準の送信は止める） */
function submit(tree: ReactNode) {
  const preventDefault = vi.fn()
  ;(form(tree).props.onSubmit as (e: { preventDefault: () => void }) => void)({ preventDefault })
  expect(preventDefault).toHaveBeenCalled()
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('メール送信画面を操作する', () => {
  function setup(requestReset: (email: string) => Promise<AuthCallResult>) {
    const controller = new ForgotPasswordController({ requestReset })
    const view = () =>
      ForgotPasswordView({
        state: controller.getSnapshot(),
        onEmailChange: controller.setEmail,
        onSubmit: () => void controller.submit(),
        onBackToForm: controller.backToForm,
      })
    return { controller, view }
  }

  it('メールアドレスを入力して送信 → 送信中はボタンと入力欄が無効 → 完了の案内が出る', async () => {
    const pending = deferred<AuthCallResult>()
    const requestReset = vi.fn(() => pending.promise)
    const { view } = setup(requestReset)

    type(view(), 'forgot-email', 'user@example.com')
    expect(inputById(view(), 'forgot-email').props.value).toBe('user@example.com')

    submit(view())
    expect(requestReset).toHaveBeenCalledWith('user@example.com')
    expect(submitButton(view()).props.disabled).toBe(true)
    expect(inputById(view(), 'forgot-email').props.disabled).toBe(true)
    expect(textOf(view())).toContain('送信中')

    pending.resolve({ error: null })
    await flush()
    expect(textOf(view())).toContain('登録されているメールアドレスの場合、パスワード再設定のご案内を送信します')
    expect(textOf(view())).not.toContain('user@example.com')
    expect(form(view())).toBeUndefined()
  })

  it('送信ボタンを連打しても、送信は1回だけ', async () => {
    const pending = deferred<AuthCallResult>()
    const requestReset = vi.fn(() => pending.promise)
    const { view } = setup(requestReset)
    type(view(), 'forgot-email', 'user@example.com')

    submit(view())
    submit(view())
    submit(view())
    expect(requestReset).toHaveBeenCalledTimes(1)
    pending.resolve({ error: null })
    await flush()
    expect(requestReset).toHaveBeenCalledTimes(1)
  })

  it('メール形式が不正 → 送信されず、入力欄の下にエラーが出る。直すとエラーが消えて送信できる', async () => {
    const requestReset = vi.fn(async () => ({ error: null }))
    const { view } = setup(requestReset)

    type(view(), 'forgot-email', 'not-an-email')
    submit(view())
    await flush()
    expect(requestReset).not.toHaveBeenCalled()
    expect(textOf(view())).toContain('有効なメールアドレスを入力してください')

    type(view(), 'forgot-email', 'user@example.com')
    expect(textOf(view())).not.toContain('有効なメールアドレスを入力してください')
    submit(view())
    await flush()
    expect(requestReset).toHaveBeenCalledTimes(1)
  })

  it('未登録のメールアドレスでも、登録済みと同じ案内になる（アカウントの存在を推測できない）', async () => {
    const results: string[] = []
    for (const email of ['registered@example.com', 'nobody@example.org']) {
      const { view } = setup(async () => ({ error: null })) // Supabase は未登録でも成功を返す
      type(view(), 'forgot-email', email)
      submit(view())
      await flush()
      results.push(textOf(view()))
    }
    expect(results[0]).toBe(results[1])
  })

  it('通信エラー → エラー表示。そのまま再送でき、成功すると案内が出る', async () => {
    const results: AuthCallResult[] = [{ error: { status: 0, name: 'AuthRetryableFetchError' } }, { error: null }]
    const requestReset = vi.fn(async () => results.shift()!)
    const { view } = setup(requestReset)
    type(view(), 'forgot-email', 'user@example.com')

    submit(view())
    await flush()
    expect(textOf(view())).toContain('通信エラーが発生しました')
    expect(submitButton(view()).props.disabled).toBe(false)

    submit(view())
    await flush()
    expect(requestReset).toHaveBeenCalledTimes(2)
    expect(textOf(view())).toContain('登録されているメールアドレスの場合')
  })

  it('送信制限のエラー → 送信制限の案内が出る', async () => {
    const { view } = setup(async () => ({ error: { status: 429, code: 'over_email_send_rate_limit' } }))
    type(view(), 'forgot-email', 'user@example.com')
    submit(view())
    await flush()
    expect(textOf(view())).toContain('送信回数の上限に達しました')
  })

  it('送信後に「別のメールアドレスで送る」を押すと入力画面に戻る', async () => {
    const { view } = setup(async () => ({ error: null }))
    type(view(), 'forgot-email', 'user@example.com')
    submit(view())
    await flush()
    const back = findAll(view(), (el) => el.type === 'button' && typeof el.props.onClick === 'function')[0]
    expect(textOf(back)).toContain('別のメールアドレスで送る')
    ;(back.props.onClick as () => void)()
    expect(form(view())).toBeDefined()
  })
})

describe('新しいパスワードの設定画面を操作する', () => {
  function setup(options: { recovery?: boolean; urlError?: 'expired' | 'invalid' | null; update?: () => Promise<AuthCallResult> } = {}) {
    const recoveryState = createRecoveryState()
    if (options.recovery ?? true) recoveryState.markRecovery()
    const updatePassword = vi.fn(options.update ?? (async () => ({ error: null })))
    const signOutRecoveredSession = vi.fn(async () => {})
    const controller = new ResetPasswordController({
      recovery: recoveryState,
      urlError: options.urlError ?? null,
      mayBeRecovery: options.recovery ?? true,
      updatePassword,
      signOutRecoveredSession,
    })
    const view = () =>
      ResetPasswordView({
        state: controller.getSnapshot(),
        onPasswordChange: controller.setPassword,
        onConfirmChange: controller.setConfirm,
        onSubmit: () => void controller.submit(),
      })
    return { controller, view, updatePassword, signOutRecoveredSession, recoveryState }
  }

  const enter = (view: () => ReactNode, password: string, confirm = password) => {
    type(view(), 'reset-password', password)
    type(view(), 'reset-password-confirm', confirm)
  }

  it('有効な Recovery セッション：新しいパスワードを2回入力して送信 → 更新され、完了の案内が出る', async () => {
    const { view, updatePassword, signOutRecoveredSession, recoveryState } = setup()
    enter(view, 'newPassword1')
    submit(view())
    await flush()

    expect(updatePassword).toHaveBeenCalledTimes(1)
    expect(updatePassword).toHaveBeenCalledWith('newPassword1')
    expect(signOutRecoveredSession).toHaveBeenCalledTimes(1)
    expect(recoveryState.isRecovery()).toBe(false)
    expect(textOf(view())).toContain('パスワードを変更しました')
    expect(textOf(view())).toContain('新しいパスワードでログインしてください')
    expect(form(view())).toBeUndefined()
  })

  it('パスワードが一致しない → 更新されず、確認欄の下にエラーが出る', async () => {
    const { view, updatePassword } = setup()
    enter(view, 'newPassword1', 'newPassword2')
    submit(view())
    await flush()
    expect(updatePassword).not.toHaveBeenCalled()
    expect(textOf(view())).toContain('確認用のパスワードが一致しません')
  })

  it('8文字未満 → 更新されず、エラーが出る', async () => {
    const { view, updatePassword } = setup()
    enter(view, 'short')
    submit(view())
    await flush()
    expect(updatePassword).not.toHaveBeenCalled()
    expect(textOf(view())).toContain('パスワードは8文字以上で入力してください')
  })

  it('送信中はボタンと入力欄が無効。連打しても更新は1回だけ', async () => {
    const pending = deferred<AuthCallResult>()
    const { view, updatePassword } = setup({ update: () => pending.promise })
    enter(view, 'newPassword1')
    submit(view())
    submit(view())
    submit(view())

    expect(updatePassword).toHaveBeenCalledTimes(1)
    expect(submitButton(view()).props.disabled).toBe(true)
    expect(inputById(view(), 'reset-password').props.disabled).toBe(true)
    expect(inputById(view(), 'reset-password-confirm').props.disabled).toBe(true)

    pending.resolve({ error: null })
    await flush()
    expect(updatePassword).toHaveBeenCalledTimes(1)
    expect(textOf(view())).toContain('パスワードを変更しました')
  })

  it('更新失敗 → エラーが出て、入力は残る。もう一度送信できる', async () => {
    const results: AuthCallResult[] = [{ error: { status: 500, code: 'unexpected_failure' } }, { error: null }]
    const { view, updatePassword } = setup({ update: async () => results.shift()! })
    enter(view, 'newPassword1')
    submit(view())
    await flush()
    expect(textOf(view())).toContain('パスワードを変更できませんでした')
    expect(inputById(view(), 'reset-password').props.value).toBe('newPassword1')

    submit(view())
    await flush()
    expect(updatePassword).toHaveBeenCalledTimes(2)
    expect(textOf(view())).toContain('パスワードを変更しました')
  })

  it('更新時にリンクが失効していた → 期限切れの案内に切り替わり、入力は消える', async () => {
    const { view } = setup({ update: async () => ({ error: { status: 401, code: 'bad_jwt' } }) })
    enter(view, 'newPassword1')
    submit(view())
    await flush()
    expect(textOf(view())).toContain('有効期限が切れています')
    expect(findAll(view(), (el) => el.type === Input)).toHaveLength(0)
  })

  it('期限切れのリンクで開いた → 入力欄は出ない。フォームも無い', () => {
    const { view, updatePassword } = setup({ urlError: 'expired' })
    expect(textOf(view())).toContain('有効期限が切れています')
    expect(form(view())).toBeUndefined()
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('通常のログインセッションだけ（Recovery なし）→ 入力欄もフォームも出ず、更新は呼ばれない', async () => {
    const { view, controller, updatePassword } = setup({ recovery: false })
    controller.waitTimeout()
    expect(textOf(view())).toContain('再設定のリンクを確認できませんでした')
    expect(form(view())).toBeUndefined()
    expect(inputById(view(), 'reset-password')).toBeUndefined()
    await controller.submit() // 画面の外から呼ばれても更新しない
    expect(updatePassword).not.toHaveBeenCalled()
  })

  it('メールのリンクから戻った直後は「確認中」。PASSWORD_RECOVERY が届くと入力画面に切り替わる', () => {
    const recoveryState = createRecoveryState()
    const controller = new ResetPasswordController({
      recovery: recoveryState,
      urlError: null,
      mayBeRecovery: true,
      updatePassword: vi.fn(),
      signOutRecoveredSession: vi.fn(),
    })
    const view = () =>
      ResetPasswordView({ state: controller.getSnapshot(), onPasswordChange: () => {}, onConfirmChange: () => {}, onSubmit: () => {} })
    const stop = controller.start()
    expect(textOf(view())).toContain('再設定のリンクを確認しています')
    expect(form(view())).toBeUndefined()

    recoveryState.markRecovery()
    expect(form(view())).toBeDefined()
    stop()
  })
})
