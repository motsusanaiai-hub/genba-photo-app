import { describe, expect, it } from 'vitest'
import {
  FREE_PROJECT_LIMIT,
  canCreateProject,
  canExportAllExcelPages,
  projectLimit,
  shouldShowAds,
} from '@/lib/plan'
import type { Plan } from '@/types/auth'

// 5. プラン別の権限判定（Pro契約終了で plan が free / ads_removed に戻ったときの画面側の判定）。

describe.each<{
  plan: Plan
  showsAds: boolean
  exportsAllExcelPages: boolean
  projectLimit: number | null
}>([
  { plan: 'free', showsAds: true, exportsAllExcelPages: false, projectLimit: FREE_PROJECT_LIMIT },
  { plan: 'ads_removed', showsAds: false, exportsAllExcelPages: false, projectLimit: FREE_PROJECT_LIMIT },
  { plan: 'pro', showsAds: false, exportsAllExcelPages: true, projectLimit: null },
])('plan = $plan', ({ plan, showsAds, exportsAllExcelPages, projectLimit: limit }) => {
  it(`広告表示：${showsAds ? '表示する' : '表示しない'}`, () => {
    expect(shouldShowAds(plan)).toBe(showsAds)
  })

  it(`Excel全ページ出力：${exportsAllExcelPages ? '可' : '不可（1ページずつ）'}`, () => {
    expect(canExportAllExcelPages(plan)).toBe(exportsAllExcelPages)
  })

  it(`工事案件の上限：${limit ?? '無制限'}`, () => {
    expect(projectLimit(plan)).toBe(limit)
  })

  if (limit === null) {
    it('件数に関係なく新規作成できる', () => {
      expect(canCreateProject(plan, 0)).toBe(true)
      expect(canCreateProject(plan, 100)).toBe(true)
    })
  } else {
    it('上限未満なら新規作成でき、上限以上ならできない', () => {
      expect(canCreateProject(plan, limit - 1)).toBe(true)
      expect(canCreateProject(plan, limit)).toBe(false)
      // Pro終了後に上限を超えて保存されている場合も「新規作成不可」になるだけ
      expect(canCreateProject(plan, limit + 7)).toBe(false)
    })
  }
})

describe('Pro契約終了による切り替え', () => {
  it('pro → free：広告が表示対象に戻り、Excel全ページ出力と無制限作成ができなくなる', () => {
    expect([shouldShowAds('pro'), shouldShowAds('free')]).toEqual([false, true])
    expect([canExportAllExcelPages('pro'), canExportAllExcelPages('free')]).toEqual([true, false])
    expect([canCreateProject('pro', 5), canCreateProject('free', 5)]).toEqual([true, false])
  })

  it('pro → ads_removed：広告は非表示のまま、Pro限定機能だけが使えなくなる', () => {
    expect(shouldShowAds('ads_removed')).toBe(false)
    expect(canExportAllExcelPages('ads_removed')).toBe(false)
    expect(canCreateProject('ads_removed', 5)).toBe(false)
  })
})
