import { describe, expect, it } from 'vitest'
import { PRODUCTION_APP_ORIGIN, resolveAppOrigin } from '../../api/_lib/appOrigin'

const preview = {
  vercelEnv: 'preview',
  vercelUrl: 'genba-abc123.vercel.app',
  vercelBranchUrl: 'genba-git-staging.vercel.app',
  vercelProductionUrl: 'genba.example.com',
}

describe('resolveAppOrigin（Checkout / Portal 共通の戻り先）', () => {
  it('Preview：ブランチURLのOriginはそのまま使う', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: 'https://genba-git-staging.vercel.app' })).toBe(
      'https://genba-git-staging.vercel.app',
    )
  })

  it('Preview：許可リスト外のOriginは正規URL（ブランチURL）に置き換える', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: 'https://evil.example' })).toBe(
      'https://genba-git-staging.vercel.app',
    )
  })

  it('Preview：許可済みホストでも http は使わない', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: 'http://genba-abc123.vercel.app' })).toBe(
      'https://genba-git-staging.vercel.app',
    )
  })

  it('Preview：Productionのドメインからのリクエストでも Preview の正規URLへ戻す', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: 'https://genba.example.com' })).toBe(
      'https://genba-git-staging.vercel.app',
    )
  })

  it('Production：本番URLは https://genba-photo-app.vercel.app に固定', () => {
    expect(PRODUCTION_APP_ORIGIN).toBe('https://genba-photo-app.vercel.app')
    expect(
      resolveAppOrigin({ ...preview, vercelEnv: 'production', requestOrigin: 'https://genba-photo-app.vercel.app' }),
    ).toBe(PRODUCTION_APP_ORIGIN)
  })

  it('不正な Origin 文字列は無視する', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: 'not a url' })).toBe('https://genba-git-staging.vercel.app')
  })

  it('ローカル：localhost だけ許可し、それ以外は null', () => {
    const local = { vercelEnv: undefined, vercelUrl: undefined, vercelBranchUrl: undefined, vercelProductionUrl: undefined }
    expect(resolveAppOrigin({ ...local, requestOrigin: 'http://localhost:5173' })).toBe('http://localhost:5173')
    expect(resolveAppOrigin({ ...local, requestOrigin: 'https://evil.example' })).toBeNull()
    expect(resolveAppOrigin({ ...local, requestOrigin: undefined })).toBeNull()
  })
})

describe('resolveAppOrigin：Production は本番URLに固定', () => {
  const production = {
    vercelEnv: 'production',
    vercelUrl: 'genba-photo-app-xyz789.vercel.app',
    vercelBranchUrl: 'genba-git-main.vercel.app',
    vercelProductionUrl: 'genba-photo-app.vercel.app',
  }

  it('VERCEL_PROJECT_PRODUCTION_URL が未設定でも本番URLを返す（null にならない）', () => {
    expect(resolveAppOrigin({ ...production, vercelProductionUrl: undefined, requestOrigin: undefined })).toBe(
      PRODUCTION_APP_ORIGIN,
    )
  })

  it('Vercel のシステム環境変数が VERCEL_ENV 以外すべて未設定でも本番URLを返す', () => {
    expect(
      resolveAppOrigin({
        vercelEnv: 'production',
        vercelUrl: undefined,
        vercelBranchUrl: undefined,
        vercelProductionUrl: undefined,
        requestOrigin: undefined,
      }),
    ).toBe(PRODUCTION_APP_ORIGIN)
  })

  it('VERCEL_PROJECT_PRODUCTION_URL が別の値（独自ドメイン等）でも本番URLを返す', () => {
    expect(resolveAppOrigin({ ...production, vercelProductionUrl: 'genba.example.jp', requestOrigin: undefined })).toBe(
      PRODUCTION_APP_ORIGIN,
    )
  })

  it.each([
    ['別ドメイン', 'https://evil.example'],
    ['http の本番ドメイン', 'http://genba-photo-app.vercel.app'],
    ['VERCEL_URL（デプロイ固有URL）', 'https://genba-photo-app-xyz789.vercel.app'],
    ['Preview のURL', 'https://genba-git-staging.vercel.app'],
    ['localhost', 'http://localhost:5173'],
    ['不正な文字列', 'not a url'],
  ])('Origin が%sでも本番URLを返す', (_label, requestOrigin) => {
    expect(resolveAppOrigin({ ...production, requestOrigin })).toBe(PRODUCTION_APP_ORIGIN)
  })

  it('VERCEL_URL が別の値でも本番URLを返す', () => {
    expect(
      resolveAppOrigin({ ...production, vercelUrl: 'other-project.vercel.app', requestOrigin: 'https://other-project.vercel.app' }),
    ).toBe(PRODUCTION_APP_ORIGIN)
  })

  it('Preview は本番URLを返さない（本番ドメインからのリクエストでも Preview のURL）', () => {
    expect(resolveAppOrigin({ ...preview, requestOrigin: PRODUCTION_APP_ORIGIN })).toBe('https://genba-git-staging.vercel.app')
    expect(resolveAppOrigin({ ...preview, vercelBranchUrl: undefined, requestOrigin: PRODUCTION_APP_ORIGIN })).toBe(
      'https://genba-abc123.vercel.app',
    )
  })
})
