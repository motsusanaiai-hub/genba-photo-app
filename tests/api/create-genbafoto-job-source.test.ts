import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 写真出力API（create-genbafoto-job）のソース構造の確認。
// 動作の確認は create-genbafoto-job.test.ts に任せ、ここでは「認可が署名より前にある」などの
// 構造と、セキュリティ・安定運用のための制限が残っていることを、ソースの文字列で確認する。
// （purchases-closed.test.ts にあった同名のブロックを、購入停止（purchaseGate）に依存しない形で独立させたもの）

const ROOT = path.resolve(__dirname, '../..')

describe('写真出力API（create-genbafoto-job）の安全制限を維持している', () => {
  const source = readFileSync(path.join(ROOT, 'api/create-genbafoto-job.ts'), 'utf8')

  it('Bearer 認証・本人確認・RLS（利用者のJWT）・所有者不一致の拒否・未同期の拒否が残っている', () => {
    expect(source).toContain("startsWith('Bearer ')")
    expect(source).toContain('auth.getUser(accessToken)')
    expect(source).toContain('Authorization: `Bearer ${accessToken}`')
    // 所有者不一致（403）・未同期（409）などの認可は _lib/photoAccess.ts に分離した（署名の前に validatePhotoAccess を通す）
    expect(source).toContain('validatePhotoAccess(')
    expect(source.indexOf('validatePhotoAccess(')).toBeLessThan(source.indexOf('createSupabaseAdminClient(env'))
    const access = readFileSync(path.join(ROOT, 'api/_lib/photoAccess.ts'), 'utf8')
    expect(access).toMatch(/photoRows\.length !== requestedPhotoIds\.length/)
    expect(access).toMatch(/status: 409/)
    expect(access).toMatch(/status: 403/)
  })

  it('写真件数の上限（300件）と署名付きURLの有効期限が残っている', () => {
    expect(source).toContain('const MAX_PHOTO_IDS = 300')
    expect(source).toContain('const SIGNED_URL_TTL_SECONDS = 1800')
  })

  it('プランを参照していない（料金による制限も、無料化のための分岐も無い）', () => {
    expect(source).not.toMatch(/\bplan\b|ads_removed|pro_override/)
  })
})
