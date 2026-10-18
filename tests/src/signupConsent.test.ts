import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { SIGNUP_CONSENT_MESSAGE, signupSchema } from '@/lib/signupSchema'
import { SignupPage } from '@/pages/auth/SignupPage'
import { LoginPage } from '@/pages/auth/LoginPage'

// 新規登録の同意チェック（利用規約・プライバシーポリシー）と、アプリ内の案内・共通リンク。
// 同意の内容はDBに保存しない（今回は実装しない）ため、ここでも「送らない」ことを確認する。

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
/** HTML属性としての disabled（クラス名の disabled: とは区別する） */
const isDisabled = (tag: string) => /\sdisabled(=""|\s|>)/.test(tag)
const render = (page: typeof SignupPage) =>
  renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: ['/'] }, createElement(page)))

const VALID = { displayName: '山田 太郎', email: 'you@example.com', password: 'password123' }

describe('新規登録の入力検証（signupSchema）', () => {
  it('同意チェックなし（false）では登録できない', () => {
    const result = signupSchema.safeParse({ ...VALID, consent: false })
    expect(result.success).toBe(false)
    if (!result.success) {
      const issue = result.error.issues.find((i) => i.path[0] === 'consent')
      expect(issue?.message).toBe(SIGNUP_CONSENT_MESSAGE)
    }
  })

  it('同意チェックが未指定でも登録できない', () => {
    expect(signupSchema.safeParse(VALID).success).toBe(false)
  })

  it('同意チェックあり（true）なら登録できる', () => {
    expect(signupSchema.safeParse({ ...VALID, consent: true }).success).toBe(true)
  })

  it('従来の入力検証（お名前・メールアドレス・パスワード8文字以上）は変わらない', () => {
    const base = { ...VALID, consent: true }
    expect(signupSchema.safeParse({ ...base, displayName: '' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, displayName: 'あ'.repeat(51) }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, password: '1234567' }).success).toBe(false)
    expect(signupSchema.safeParse({ ...base, password: '12345678' }).success).toBe(true)
  })
})

describe('新規登録画面', () => {
  const html = render(SignupPage)

  it('チェックボックスと、利用規約・プライバシーポリシーへのリンク（別タブ）がある', () => {
    expect(html).toContain('type="checkbox"')
    const terms = html.match(/<a [^>]*href="\/terms"[^>]*>/)?.[0] ?? ''
    const privacy = html.match(/<a [^>]*href="\/privacy"[^>]*>/)?.[0] ?? ''
    for (const tag of [terms, privacy]) {
      expect(tag).toContain('target="_blank"')
      expect(tag).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"|rel="[^"]*noreferrer[^"]*noopener[^"]*"/)
    }
    expect(html.replace(/<[^>]+>/g, '')).toContain('利用規約とプライバシーポリシーを確認し、同意します')
  })

  it('最初はチェックされておらず、登録ボタンは押せない', () => {
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked/)
    const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? ''
    expect(isDisabled(button)).toBe(true)
  })

  it('スマホでも押しやすい（チェック欄は20px、ラベル全体がタップ対象）', () => {
    expect(html).toContain('h-5 w-5')
    expect(html).toMatch(/<label[^>]*class="[^"]*flex[^"]*items-start/)
  })

  it('同意の有無は登録APIへ送らない（signUp には表示名・メール・パスワードだけ渡す）', () => {
    const source = read('src/pages/auth/SignupPage.tsx')
    expect(source).toContain('signUp(values.email, values.password, values.displayName)')
    expect(source).not.toMatch(/signUp\([^)]*consent/)
    expect(read('src/hooks/useAuth.ts')).not.toMatch(/consent/)
  })
})

describe('ログインへの影響なし', () => {
  const html = render(LoginPage)

  it('ログイン画面に同意チェックは無い（既存ユーザーのログインを妨げない）', () => {
    expect(html).not.toContain('type="checkbox"')
    expect(html.replace(/<[^>]+>/g, '')).not.toContain('同意')
    const source = read('src/pages/auth/LoginPage.tsx')
    expect(source).not.toMatch(/consent|signupSchema/)
    expect(source).toContain('signIn(values.email, values.password)')
  })

  it('ログインのボタンは最初から押せる', () => {
    const button = html.match(/<button[^>]*type="submit"[^>]*>/)?.[0] ?? ''
    expect(isDisabled(button)).toBe(false)
  })
})

describe('共通リンクとアプリ内の案内', () => {
  it('ログイン画面・新規登録画面の共通レイアウトから、規約とプライバシーポリシーを別タブで開ける', () => {
    const source = read('src/components/layout/AuthLayout.tsx')
    for (const to of ['/terms', '/privacy']) {
      expect(source).toMatch(new RegExp(`<Link to="${to}" target="_blank" rel="noopener noreferrer"`))
    }
  })

  it('ダッシュボードから、規約とプライバシーポリシーを開ける', () => {
    const source = read('src/pages/DashboardPage.tsx')
    expect(source).toMatch(/<Link to="\/terms"/)
    expect(source).toMatch(/<Link to="\/privacy"/)
  })

  it('ダッシュボード：クラウド保存の説明（圧縮画像・署名URL）は折りたたみで、画面を占有しない', () => {
    const source = read('src/pages/DashboardPage.tsx')
    expect(source).toContain('<details>')
    expect(source).toContain('小さくした写真（圧縮画像）は、クラウドに保存されます')
    expect(source).toContain('取得には、認証付きの通信または有効期限付きの署名URLを使います')
    expect(source).toContain('署名URLを知っている第三者は、有効期限内に見られる場合があります')
    expect(source).not.toContain('公開URL方式')
  })

  it('写真取込画面：元画像の保存先とバックアップの案内がある。取り込み処理は変えていない', () => {
    const source = read('src/components/photo/PhotoUploadModal.tsx')
    expect(source).toContain('元の写真は、この端末のブラウザ内にだけ保存されます。大切な写真は、別の場所にも保存してください。')
    expect(source).toContain('await uploadPhotosWithPhases(')
    expect(source).toContain('const { uploadPhotosWithPhases } = usePhotos(projectId)')
  })

  it('写真ZIP出力：元画像はこの端末に残っている分だけ出力できる、と説明している。出力処理は変えていない', () => {
    const source = read('src/components/project/ZipExportButton.tsx')
    expect(source).toContain('元画像は、この端末に残っている分だけ出力できます。')
    expect(source).toContain("const { generateZip } = await import('@/lib/generateZip')")
  })

  it('写真・同期・出力の処理本体は、このSTEPで変えていない（案内の追加だけ）', () => {
    // これらのファイルは規約・案内に関わらないため、規約ページの文言やリンクを持たない
    for (const file of [
      'src/hooks/usePhotos.ts',
      'src/lib/cloudSync.ts',
      'src/hooks/useCloudSync.ts',
      'src/lib/photoStorage.ts',
      'src/lib/generateZip.ts',
      'src/lib/generateExcel.ts',
      'src/lib/generateGenbafotoJob.ts',
    ]) {
      expect(read(file)).not.toMatch(/\/terms|\/privacy|legalInfo|signupSchema/)
    }
  })
})
