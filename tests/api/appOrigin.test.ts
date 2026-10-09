import { describe, expect, it } from 'vitest'
import { resolveAppOrigin } from '../../api/_lib/appOrigin'

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

  it('Production：正規の本番URLへ戻す', () => {
    expect(
      resolveAppOrigin({ ...preview, vercelEnv: 'production', requestOrigin: 'https://evil.example' }),
    ).toBe('https://genba.example.com')
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
