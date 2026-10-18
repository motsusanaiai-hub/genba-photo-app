import { describe, expect, it } from 'vitest'
import { canCreateProject, canExportAllExcelPages, projectLimit, shouldShowAds } from '@/lib/plan'
import type { Plan } from '@/types/auth'

// 完全無料化：プラン（free / ads_removed / pro）による機能差はない。
// 違いは広告の表示だけ（free は表示、過去の購入者の ads_removed と pro は表示しない）。
// 既存の plan 値（過去の購入履歴・恒久Proなど）が何であっても、機能の判定は同じ結果になることを確認する。

const PLANS: Plan[] = ['free', 'ads_removed', 'pro']

describe.each(PLANS)('plan = %s', (plan) => {
  it('広告は free のときだけ表示する（ads_removed・pro は表示しない）', () => {
    expect(shouldShowAds(plan)).toBe(plan === 'free')
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
  it('広告の表示以外は、どのプランでも判定結果が同じ', () => {
    const results = PLANS.map((plan) => [
      canExportAllExcelPages(plan),
      projectLimit(plan),
      canCreateProject(plan, 50),
    ])
    expect(results[1]).toEqual(results[0])
    expect(results[2]).toEqual(results[0])
  })

  it('広告の表示は購入者の権利に沿う（free のみ表示。ads_removed・pro は非表示）', () => {
    expect([shouldShowAds('pro'), shouldShowAds('free'), shouldShowAds('ads_removed')]).toEqual([false, true, false])
  })

  it('旧プラン（Pro → free / ads_removed への切り替え）でも、機能は減らない', () => {
    expect(canExportAllExcelPages('free')).toBe(true)
    expect(canCreateProject('free', 5)).toBe(true)
    expect(canCreateProject('ads_removed', 5)).toBe(true)
  })
})
