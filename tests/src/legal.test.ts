import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { TermsPage } from '@/pages/legal/TermsPage'
import { PrivacyPage } from '@/pages/legal/PrivacyPage'
import { LEGAL, LEGAL_PENDING_ITEMS, LEGAL_PENDING_MARK } from '@/lib/legalInfo'

// 利用規約（/terms）・プライバシーポリシー（/privacy）。
// 認証ストアにも Supabase にも触れずに描画できること（＝未ログインで開けること）、
// 実装と矛盾する説明が無いこと、未確定の運営者情報が「未確定」として明示されていることを確認する。

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

function render(page: typeof TermsPage, url: string): string {
  return renderToStaticMarkup(createElement(MemoryRouter, { initialEntries: [url] }, createElement(page)))
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
/** タグを除いた本文（空白は詰める） */
const textOf = (html: string) => decode(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, '')

const terms = render(TermsPage, '/terms')
const privacy = render(PrivacyPage, '/privacy')
const termsText = textOf(terms)
const privacyText = textOf(privacy)

describe('公開ページ（ログイン不要）', () => {
  it('未ログインの状態（認証ストアなし）で、/terms と /privacy を描画できる', () => {
    expect(terms).toContain('利用規約')
    expect(privacy).toContain('プライバシーポリシー')
  })

  it('規約ページのソースは、認証・Supabase・課金のコードを参照しない', () => {
    for (const file of [
      'src/pages/legal/TermsPage.tsx',
      'src/pages/legal/PrivacyPage.tsx',
      'src/components/legal/LegalLayout.tsx',
      'src/lib/legalInfo.ts',
    ]) {
      // 本文に「Supabase」と書くのは問題ない。確認するのは import している先（モジュール）。
      const imports = [...read(file).matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1])
      expect(imports.filter((m) => /authStore|useAuth|AuthGuard|supabase|stripe|useCloudSync|photoStorage|cloudSync/i.test(m))).toEqual([])
    }
  })

  it('ルートは AuthGuard の外にあり、直接URLで開ける（SPAのrewriteは vercel.json で全パスに適用）', () => {
    const router = read('src/router.tsx')
    const terms = router.indexOf("path: '/terms'")
    const privacy = router.indexOf("path: '/privacy'")
    const guard = router.indexOf('<AuthGuard>')
    const fallback = router.indexOf("path: '*'")
    expect(terms).toBeGreaterThan(-1)
    expect(privacy).toBeGreaterThan(-1)
    expect(terms).toBeLessThan(guard)
    expect(privacy).toBeLessThan(guard)
    expect(fallback).toBeGreaterThan(guard)
    expect(JSON.parse(read('vercel.json')).rewrites[0]).toEqual({ source: '/(.*)', destination: '/index.html' })
  })

  it('通常のテキスト表示（表・画像・入力欄・スクリプトを使わず、印刷・コピーができる）', () => {
    for (const html of [terms, privacy]) {
      expect(html).not.toMatch(/<table|<img|<canvas|<iframe|<script|<input|user-select:\s*none|select-none/)
    }
  })

  it('スマホ幅で崩れにくいレイアウト（最大幅・左右の余白・折り返し。固定幅や横スクロールなし）', () => {
    const layout = read('src/components/legal/LegalLayout.tsx')
    expect(layout).toContain('max-w-2xl')
    expect(layout).toContain('px-4')
    expect(layout).toContain('break-words')
    expect(layout).not.toMatch(/\bw-\[\d+px\]|min-w-\[|whitespace-nowrap|overflow-x-/)
  })
})

describe('利用規約の内容', () => {
  it('運営者・サービス名・目的・無料・広告・有料プランの新規販売終了を記載している', () => {
    expect(termsText).toContain(LEGAL.operatorName)
    expect(termsText).toContain('「現場フォト」')
    expect(termsText).toContain('建築・補修工事向けの写真整理・写真台帳作成サービス')
    expect(termsText).toContain('基本機能は、すべて無料')
    expect(termsText).toContain('広告が表示されます')
    expect(termsText).toContain('有料プラン（広告削除プラン、Proプラン）は、新規の販売を終了しました')
  })

  it('アカウント管理・禁止事項・サービスの変更停止・免責・規約変更・問い合わせ先の条文がある', () => {
    for (const title of ['アカウントの管理', '禁止事項', 'サービスの変更・停止', '免責事項', '規約の変更', '運営者とお問い合わせ']) {
      expect(termsText).toContain(title)
    }
  })

  it('原本の保存先・バックアップ・ZIP出力の範囲を実装どおりに説明している', () => {
    expect(termsText).toContain('端末のブラウザ内（IndexedDB）にだけ保存されます')
    expect(termsText).toContain('ブラウザのデータ削除')
    expect(termsText).toContain('端末を変えても、原本は自動では引き継がれません')
    expect(termsText).toContain('ご自身でバックアップ')
    expect(termsText).toContain('ブラウザ内に原本が残っている写真だけです')
  })

  it('公開URL方式であること（URLを知っていればログインなしで見られること）を隠さない', () => {
    expect(termsText).toContain('公開URL')
    expect(termsText).toContain('URLを知っている人は、ログインしなくても、その圧縮画像を見ることができます')
  })

  it('データ削除：写真削除・工事案件削除（論理削除で端末内は残る）・ログアウト・退会機能が未実装であることを説明している', () => {
    expect(termsText).toContain('写真を削除')
    expect(termsText).toContain('「削除済み」として扱われます')
    expect(termsText).toContain('端末内の写真（原本・圧縮画像）は削除されず、そのまま残ります')
    expect(termsText).toContain('ログアウトしても、端末内の原本や写真・工事の情報は消えません')
    expect(termsText).toContain('アカウントの削除（退会）機能は、現在、アプリ内にありません')
  })

  it('免責は一方的な全面免除ではない（故意・重大な過失は除く／確認の責任は双方向に書く）', () => {
    expect(termsText).toContain('当社に故意または重大な過失がある場合を除き')
    expect(termsText).not.toMatch(/一切の責任を負いません|いかなる(場合|責任)も/)
  })
})

describe('プライバシーポリシーの内容', () => {
  it('取得する情報（アカウント・工事案件・写真に付随する情報・圧縮画像）を記載している', () => {
    for (const phrase of ['アカウント情報', '工事案件の情報', '写真に付随する情報', '圧縮画像', 'メールアドレス', '撮影日時']) {
      expect(privacyText).toContain(phrase)
    }
  })

  it('写真の保存方式：元画像は端末のIndexedDB、圧縮画像（600px程度）はクラウド', () => {
    expect(privacyText).toContain('端末のブラウザ内（IndexedDB）にだけ保存されます')
    expect(privacyText).toContain('600px程度')
    expect(privacyText).toContain('当社のサーバーには送られません')
  })

  it('現状の公開バケット（公開URL方式）を、隠さず正確に説明している', () => {
    expect(privacyText).toContain('公開URL')
    expect(privacyText).toContain('URLを知っている人は、ログインしなくても、その圧縮画像を見ることができます')
    expect(privacyText).toContain('ログインしなくても、その圧縮画像を取得できる可能性があります')
  })

  it('実装と異なる説明（非公開・第三者は閲覧できない・private化後の仕様）を書いていない', () => {
    expect(privacyText).not.toMatch(/第三者は写真を閲覧できません|すべての写真は非公開|非公開で(す|保存)|閲覧できません|private|プライベート|署名付き.*のみ/i)
    expect(termsText).not.toMatch(/第三者は写真を閲覧できません|すべての写真は非公開|閲覧できません|private|プライベート/i)
  })

  it('外部サービスは、コードで確認できる Supabase・Vercel・Stripe（過去の決済用）だけ。広告配信・解析サービスを書き足していない', () => {
    for (const name of ['Supabase', 'Vercel', 'Stripe']) expect(privacyText).toContain(name)
    expect(privacyText).toContain('有料プランの新規販売を行っていません')
    expect(privacyText).toContain('広告配信サービスやアクセス解析サービスは、現時点では使っていません')
    expect(privacyText).not.toMatch(/Google|AdSense|AdMob|Analytics|Firebase|Facebook|Meta|Sentry|Hotjar|Amazon/i)
  })

  it('データ削除：工事案件削除（論理削除・端末内は残る）・ログアウト・退会機能が未実装であることを説明している', () => {
    expect(privacyText).toContain('「削除済み」として扱われます')
    expect(privacyText).toContain('端末内の写真（原本・圧縮画像）は削除されず、そのまま残ります')
    expect(privacyText).toContain('ログアウト')
    expect(privacyText).toContain('端末内の原本や、写真・工事案件の情報は消えません')
    expect(privacyText).toContain('現在、アプリ内に機能がありません')
    expect(privacyText).toContain('自動で削除する仕組みはありません')
  })

  it('利用目的・第三者提供・安全管理・問い合わせ先・変更時の案内がある', () => {
    for (const title of ['利用目的', '第三者への提供', '安全管理', '事業者の情報とお問い合わせ', 'ポリシーの変更']) {
      expect(privacyText).toContain(title)
    }
  })
})

describe('未確定の運営者情報（勝手に決めない）', () => {
  const pendingKeys = (html: string) => [...html.matchAll(/data-legal-pending="(\w+)"/g)].map((m) => m[1])

  it('問い合わせ先・制定日・準拠法/管轄・退会の受付方法・責任の範囲・所在地は「未確定」と表示している', () => {
    const all = new Set([...pendingKeys(terms), ...pendingKeys(privacy)])
    expect([...all].sort()).toEqual(Object.keys(LEGAL_PENDING_ITEMS).sort())
    expect(terms).toContain(LEGAL_PENDING_MARK)
    expect(privacy).toContain(LEGAL_PENDING_MARK)
  })

  it('実在しないメールアドレス・問い合わせフォームURLを作っていない（確認できるURLは運営者サイトのみ）', () => {
    for (const html of [terms, privacy]) {
      const text = decode(html.replace(/<[^>]+>/g, ' '))
      expect(text).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
      expect(text).not.toMatch(/tel:|電話番号|フォーム(URL|は)/)
      // リンク先（href）だけを数える（アイコンの XML 名前空間などは対象外）
      const urls = [...decode(html).matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
      expect([...new Set(urls)]).toEqual([LEGAL.operatorSiteUrl])
    }
  })

  it('運営者の名称とサイトは、自社広告（houseAds）と同じ確認済みの値を使っている', () => {
    const ads = read('src/lib/houseAds.ts')
    expect(ads).toContain(LEGAL.operatorName)
    expect(ads).toContain(LEGAL.operatorSiteUrl)
  })
})
