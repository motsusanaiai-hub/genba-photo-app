import { describe, expect, it } from 'vitest'
import { canCreateProject, canExportAllExcelPages, projectLimit, shouldShowAds } from '@/lib/plan'
import type { Plan } from '@/types/auth'

// 完全無料化：プラン（free / ads_removed / pro）による機能差はない。
// 広告削除プラン・Proプランは廃止したが、plan 列と判定関数の入口は残してあるため、
// 既存の plan 値（過去の購入履歴・恒久Proなど）が何であっても同じ結果になることを確認する。

const PLANS: Plan[] = ['free', 'ads_removed', 'pro']

describe.each(PLANS)('plan = %s', (plan) => {
  it('広告を表示する（全プラン共通）', () => {
    expect(shouldShowAds(plan)).toBe(true)
  })

  it('Excelを全ページ出力できる（1ページ制限なし）', () => {
    expect(canExportAllExcelPages(plan)).toBe(true)
  })

  it('工事案件の上限はない', () => {
    expect(projectLimit(plan)).toBeNull()
  })

  it('工事案件を4件以上でも、何件でも新規作成できる', () => {
    for (const count of [0, 1, 2, 3, 4, 5, 10, 100, 1000]) {
      expect(canCreateProject(plan, count)).toBe(true)
    }
  })
})

describe('プランによる機能差がない', () => {
  it('どのプランでも判定結果が同じ', () => {
    const results = PLANS.map((plan) => [
      shouldShowAds(plan),
      canExportAllExcelPages(plan),
      projectLimit(plan),
      canCreateProject(plan, 50),
    ])
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('旧プラン（Pro → free / ads_removed への切り替え）でも、機能が減ったり広告が消えたりしない', () => {
    expect([shouldShowAds('pro'), shouldShowAds('free'), shouldShowAds('ads_removed')]).toEqual([true, true, true])
    expect(canExportAllExcelPages('free')).toBe(true)
    expect(canCreateProject('free', 5)).toBe(true)
    expect(canCreateProject('ads_removed', 5)).toBe(true)
  })
})
