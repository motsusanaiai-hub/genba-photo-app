import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// 6. 既存データの保護：Pro → Free / ads_removed への切り替えで、工事案件や写真を削除する処理が走らないこと。
//
// plan を「決める」処理（Webhook同期）と plan を「読む」処理（権限判定・表示）のソースに、
// 削除系の呼び出しが含まれていないことを静的に確認する。
// 削除は利用者の明示的な操作（確認ダイアログ付きの removeProject / 写真・フォルダ削除）からだけ呼ばれる設計。
// ※ DB側（recompute_plan / complete_subscription_sync）が profiles.plan と課金テーブル以外を
//   変更しないことは SQL のため、ここでは保証できない（SQLテストで確認する）。

const ROOT = path.resolve(__dirname, '../..')

const PLAN_RELATED_FILES = [
  // plan を決める（Webhook → 同期）
  'api/webhooks/stripe.ts',
  'api/_lib/proSubscriptionSync.ts',
  // plan を読む（権限判定・表示）
  'src/lib/plan.ts',
  'src/lib/subscription.ts',
  'src/hooks/useAuth.ts',
  'src/hooks/useExcelPageExport.ts',
  'src/components/common/AdSlot.tsx',
  'src/components/billing/RemoveAdsButton.tsx',
  'src/components/billing/ProCheckoutButton.tsx',
  'src/components/billing/ManageSubscriptionCard.tsx',
]

const DELETION_PATTERNS: Array<[string, RegExp]> = [
  ['Supabase の delete()', /\.delete\(/],
  ['Storage の remove()', /\.remove\(/],
  ['工事案件の削除', /\b(removeProject|deleteProject|deleteProjectFromCloud)\b/],
  ['写真の削除', /\b(deletePhoto|removePhoto|removePhotos)\b/],
  ['フォルダの削除', /\b(removeFolder|deleteFolder)\b/],
  ["工事案件・写真テーブルの参照", /from\(\s*['"](projects|photos|photo_folders)['"]\s*\)/],
]

describe('plan の切り替えに関わるコードに、データ削除の処理が含まれない', () => {
  it.each(PLAN_RELATED_FILES)('%s', (file) => {
    const source = readFileSync(path.join(ROOT, file), 'utf8')
    const found = DELETION_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([label]) => label)
    expect(found).toEqual([])
  })
})

describe('工事案件の上限は「新規作成の可否」にだけ使われる', () => {
  it('useProjects は上限判定を作成処理のガードにだけ使い、削除処理の条件にしていない', () => {
    const source = readFileSync(path.join(ROOT, 'src/hooks/useProjects.ts'), 'utf8')
    const start = source.indexOf('const removeProject')
    const end = source.indexOf('const getProject', start)
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    const removeProjectBody = source.slice(start, end)
    expect(source).toMatch(/if \(!canCreateNewProject\) return null/)
    expect(removeProjectBody).not.toMatch(/canCreateNewProject|canCreateProject|plan/)
  })
})
