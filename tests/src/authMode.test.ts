import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { isValidSupabaseConfig, resolveAuthMode } from '@/lib/authMode'

// 本番ビルドで Supabase の設定が不足していても、モック認証に切り替わらないこと。
// 値はテスト用のダミー（実際の環境変数は読まない）。

const VALID_URL = 'https://example-ref.supabase.co'
const VALID_KEY = 'dummy-anon-key-0123456789abcdef'

describe('resolveAuthMode', () => {
  it.each([true, false])('正しい設定なら isProd=%s でも Supabase 認証を使う', (isProd) => {
    expect(resolveAuthMode({ url: VALID_URL, anonKey: VALID_KEY, isProd })).toBe('supabase')
  })

  it.each<[string, string, string]>([
    ['URL・key とも未設定', '', ''],
    ['URL のみ未設定', '', VALID_KEY],
    ['key のみ未設定', VALID_URL, ''],
    ['URL が https でない', 'http://example-ref.supabase.co', VALID_KEY],
    ['URL が placeholder', 'https://placeholder.supabase.co', VALID_KEY],
    ['key が短すぎる', VALID_URL, 'short-key'],
  ])('本番ビルドで%sの場合はモックにせず misconfigured', (_label, url, anonKey) => {
    expect(resolveAuthMode({ url, anonKey, isProd: true })).toBe('misconfigured')
  })

  it.each<[string, string, string]>([
    ['URL・key とも未設定', '', ''],
    ['URL が placeholder', 'https://placeholder.supabase.co', VALID_KEY],
  ])('開発ビルドで%sの場合は従来どおりモック認証', (_label, url, anonKey) => {
    expect(resolveAuthMode({ url, anonKey, isProd: false })).toBe('mock')
  })
})

describe('isValidSupabaseConfig：URL と anon key の検証', () => {
  it('正常な Supabase URL と21文字以上の key は有効', () => {
    expect(isValidSupabaseConfig(VALID_URL, VALID_KEY)).toBe(true)
    expect(isValidSupabaseConfig(`${VALID_URL}/`, VALID_KEY)).toBe(true)
  })

  it('anon key は21文字以上で有効、20文字以下は無効', () => {
    expect(isValidSupabaseConfig(VALID_URL, 'x'.repeat(20))).toBe(false)
    expect(isValidSupabaseConfig(VALID_URL, 'x'.repeat(21))).toBe(true)
  })

  it.each<[string, string]>([
    ['空文字', ''],
    ['https:// だけ', 'https://'],
    ['空白を含む', 'https://exa mple.supabase.co'],
    ['角括弧が閉じていない', 'https://[example'],
    ['http://', 'http://example-ref.supabase.co'],
    ['https 以外のスキーム', 'ftp://example-ref.supabase.co'],
    ['スキームが無い', 'example-ref.supabase.co'],
    ['placeholder を含む', 'https://placeholder.supabase.co'],
    ['ユーザー名を含む', 'https://user@example-ref.supabase.co'],
    ['ユーザー名とパスワードを含む', 'https://user:pass@example-ref.supabase.co'],
  ])('URL が%sなら無効', (_label, url) => {
    expect(isValidSupabaseConfig(url, VALID_KEY)).toBe(false)
  })

  // 画面が真っ白になる原因（createClient が読み込み時に例外を投げる）を、有効と判定したURLでは起こさないこと。
  it('有効と判定した URL は createClient で例外にならない／例外になる URL は無効と判定する', () => {
    const cases = [VALID_URL, `${VALID_URL}/`, 'https://', 'https://exa mple.supabase.co', 'https://[example']
    for (const url of cases) {
      let throws = false
      try {
        createClient(url, VALID_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
      } catch {
        throws = true
      }
      if (isValidSupabaseConfig(url, VALID_KEY)) expect(throws, url).toBe(false)
      if (throws) expect(isValidSupabaseConfig(url, VALID_KEY), url).toBe(false)
    }
  })
})

describe('resolveAuthMode：形式が壊れた URL', () => {
  it.each(['https://', 'https://exa mple.supabase.co', 'https://user:pass@example-ref.supabase.co'])(
    '本番ビルドでは %s を misconfigured（設定エラー画面）にする',
    (url) => {
      expect(resolveAuthMode({ url, anonKey: VALID_KEY, isProd: true })).toBe('misconfigured')
    },
  )

  it.each(['https://', 'https://exa mple.supabase.co', 'https://user:pass@example-ref.supabase.co'])(
    '開発ビルドでは %s を従来どおりモック認証にする',
    (url) => {
      expect(resolveAuthMode({ url, anonKey: VALID_KEY, isProd: false })).toBe('mock')
    },
  )
})

// useAuth はReactフックのため、ここではモック認証の各分岐が misconfigured を先に除外していることを静的に確認する。
describe('useAuth のモック認証は misconfigured では使われない', () => {
  const source = readFileSync(path.resolve(__dirname, '../../src/hooks/useAuth.ts'), 'utf8')

  it('モック認証の分岐は authMode で判定している（設定の有無だけで分岐しない）', () => {
    expect(source).not.toMatch(/if \(!isSupabaseConfigured \|\| !supabase\)/)
    expect(source.match(/if \(authMode === 'mock' \|\| !supabase\)/g)).toHaveLength(4)
  })

  it('initialize / signIn / signUp / signOut のそれぞれで misconfigured を先に処理する', () => {
    const misconfiguredIndexes = [...source.matchAll(/authMode === 'misconfigured'/g)].map((m) => m.index!)
    const mockIndexes = [...source.matchAll(/authMode === 'mock' \|\| !supabase/g)].map((m) => m.index!)
    expect(misconfiguredIndexes).toHaveLength(4)
    misconfiguredIndexes.forEach((index, i) => expect(index).toBeLessThan(mockIndexes[i]))
  })
})
