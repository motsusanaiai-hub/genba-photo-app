import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUser, Plan } from '@/types/auth'

// ダッシュボードの自社広告（AdSlot → AdFrame → HouseAdCard）。
// zustand のフックはサーバー描画では初期状態しか返さないため、authStore を
// 「実際の zustand ストア ＋ 現在の状態を読むフック」に差し替える。
// これにより refreshPlan（プラン自動更新）が更新した plan で広告の表示が切り替わることも確認できる。

vi.mock('@/store/authStore', async () => {
  const { createStore } = await import('zustand/vanilla')
  const store = createStore<{
    user: AppUser | null
    initialized: boolean
    setUser: (user: AppUser | null) => void
    setInitialized: (initialized: boolean) => void
  }>((set) => ({
    user: null,
    initialized: true,
    setUser: (user) => set({ user }),
    setInitialized: (initialized) => set({ initialized }),
  }))
  const useAuthStore = Object.assign(
    <T>(selector: (s: ReturnType<typeof store.getState>) => T) => selector(store.getState()),
    store,
  )
  return { useAuthStore }
})

import { useAuthStore } from '@/store/authStore'
import { AdSlot } from '@/components/common/AdSlot'
import { HOUSE_ADS } from '@/lib/houseAds'
import { shouldShowAds } from '@/lib/plan'
import { refreshPlan } from '@/lib/planRefresh'

const ROOT = path.resolve(__dirname, '../..')
const USER: AppUser = { id: 'user-1', email: 'user@example.com', display_name: 'user', plan: 'free' }

function setPlan(plan: Plan) {
  useAuthStore.getState().setUser({ ...USER, plan })
}

function render(): string {
  return renderToStaticMarkup(createElement(AdSlot, { className: 'mt-6' }))
}

/** 描画結果から <a> 要素の開始タグを1つ取り出す。 */
function anchorTag(html: string): string {
  const tags = html.match(/<a\s[^>]*>/g) ?? []
  expect(tags).toHaveLength(1)
  return tags[0]
}

/** HTML中の文字列（&amp; 等のエスケープを戻したもの）。 */
function text(html: string): string {
  return html.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
}

beforeEach(() => {
  useAuthStore.getState().setUser(null)
})

describe('AdSlot：プラン別の表示', () => {
  it('free では自社広告を表示する', () => {
    setPlan('free')
    expect(text(render())).toContain(HOUSE_ADS.dashboard.headline)
  })

  it.each<Plan>(['ads_removed', 'pro'])('%s では何も描画しない（DOMを残さない）', (plan) => {
    setPlan(plan)
    expect(render()).toBe('')
  })

  it.each<Plan>(['free', 'ads_removed', 'pro'])('%s の表示有無は既存の shouldShowAds と一致する', (plan) => {
    setPlan(plan)
    expect(render() !== '').toBe(shouldShowAds(plan))
  })

  it('呼び出し側の余白クラスは広告を表示するときだけ付く', () => {
    setPlan('free')
    expect(render()).toContain('mt-6')
    setPlan('pro')
    expect(render()).not.toContain('mt-6')
  })
})

describe('AdSlot：プラン自動更新との連動', () => {
  it('free → pro（Pro購入の反映）で広告が消える', async () => {
    setPlan('free')
    expect(render()).not.toBe('')
    await refreshPlan(async () => 'pro')
    expect(render()).toBe('')
  })

  it('free → ads_removed（広告削除の購入）で広告が消える', async () => {
    setPlan('free')
    await refreshPlan(async () => 'ads_removed')
    expect(render()).toBe('')
  })

  it('pro → free（Pro契約の終了）で広告が表示される', async () => {
    setPlan('pro')
    expect(render()).toBe('')
    await refreshPlan(async () => 'free')
    expect(text(render())).toContain(HOUSE_ADS.dashboard.headline)
  })

  it('pro → ads_removed（広告削除購入者のPro終了）では広告は表示されないまま', async () => {
    setPlan('pro')
    await refreshPlan(async () => 'ads_removed')
    expect(render()).toBe('')
  })
})

describe('AdSlot：広告の内容', () => {
  beforeEach(() => setPlan('free'))

  it('「広告」ラベルと広告主名・サービス名を表示する', () => {
    const html = text(render())
    expect(html).toMatch(/>広告<\/span>/)
    expect(html).toContain('株式会社ACE')
    expect(html).toContain('ACE-DX')
  })

  it('キャッチコピー・説明文・ボタンの文言が指定どおり', () => {
    const html = text(render())
    expect(html).toContain('建設現場の「面倒」を、AIでもっと簡単に。')
    expect(html).toContain('写真管理・工程調整・社内資料検索など、建設業の業務改善をAIでサポート。')
    expect(html).toContain('ACE-DXのサービスを見る →')
  })

  it('画像・外部スクリプト・iframe を使わない', () => {
    expect(render()).not.toMatch(/<img|<script|<iframe|<svg/)
  })

  it('ボタンはリンクの中で <button> を使わない（リンクの入れ子・二重操作を避ける）', () => {
    expect(render()).not.toContain('<button')
  })
})

describe('AdSlot：リンク', () => {
  beforeEach(() => setPlan('free'))

  it('リンク先は https://ace-dx.jp/', () => {
    const href = anchorTag(render()).match(/href="([^"]*)"/)?.[1]
    expect(href).toBe('https://ace-dx.jp/')
    expect(HOUSE_ADS.dashboard.url).toBe('https://ace-dx.jp/')
  })

  it('新しいタブで開き、rel に noopener と noreferrer を含む', () => {
    const tag = anchorTag(render())
    expect(tag).toContain('target="_blank"')
    const rel = tag.match(/rel="([^"]*)"/)?.[1].split(' ') ?? []
    expect(rel).toEqual(expect.arrayContaining(['noopener', 'noreferrer']))
  })

  it('カード全体（キャッチコピー〜ボタン）が1つのリンクで、キーボードでも操作できる', () => {
    const html = text(render())
    const tag = anchorTag(render())
    expect(tag).not.toContain('tabindex')
    expect(html.startsWith('<div')).toBe(true)
    const linkStart = html.indexOf('<a ')
    const linkEnd = html.indexOf('</a>')
    for (const part of [HOUSE_ADS.dashboard.headline, HOUSE_ADS.dashboard.cta]) {
      const at = html.indexOf(part)
      expect(at).toBeGreaterThan(linkStart)
      expect(at).toBeLessThan(linkEnd)
    }
    expect(html).toContain('新しいタブで開きます')
  })
})

describe('AdSlot：PC・スマホの表示', () => {
  beforeEach(() => setPlan('free'))

  it('スマホは縦並び、PC（sm以上）は横並びになるクラスを持つ', () => {
    const html = render()
    expect(html).toContain('flex-col')
    expect(html).toContain('sm:flex-row')
  })

  it('最大幅を抑えて中央に置く（工事案件一覧を圧迫しない）', () => {
    expect(render()).toContain('max-w-2xl')
    expect(render()).toContain('mx-auto')
  })

  it('アニメーション・固定配置（ポップアップ）を使わない', () => {
    expect(render()).not.toMatch(/animate-|fixed|sticky|absolute/)
  })

  it('説明文は最大2行に抑える', () => {
    expect(render()).toContain('line-clamp-2')
  })
})

describe('既存機能への影響', () => {
  function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const full = path.join(dir, name)
      return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
    })
  }

  it('広告を使っているのはダッシュボードだけ（撮影・写真整理・Excel・ログイン・決済画面には無い）', () => {
    const users = sourceFiles(path.join(ROOT, 'src'))
      .filter((file) => /from '@\/components\/common\/(AdSlot|HouseAdCard)'/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(ROOT, file))
      .sort()
    expect(users).toEqual(['src/components/common/AdSlot.tsx', 'src/pages/DashboardPage.tsx'])
  })

  it('広告のコードは写真・工事案件・フォルダの処理や Supabase / Stripe を参照しない', () => {
    for (const file of ['src/components/common/AdSlot.tsx', 'src/components/common/HouseAdCard.tsx', 'src/lib/houseAds.ts']) {
      const source = readFileSync(path.join(ROOT, file), 'utf8')
      expect(source).not.toMatch(/photoStore|projectStore|folderStore|cloudSync|photoStorage|supabase|stripe/i)
    }
  })
})
