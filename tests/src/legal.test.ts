import { execFileSync } from 'node:child_process'
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
const textOf = (html: string) =>
  decode(html.replace(/<[^>]+>/g, ''))
    .replace(/（新しいタブで開きます）/g, '') // リンクの読み上げ用の補足（画面には出ない）は、本文として数えない
    .replace(/\s+/g, '')

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

  it('クラウド画像の取得方法（認証付き通信・有効期限付きの署名URL）と、署名URLを知る第三者が見られる場合があることを隠さない', () => {
    expect(termsText).toContain('認証付きの通信')
    expect(termsText).toContain('有効期限付きの署名URL')
    expect(termsText).toContain('署名URLを知っている第三者は、有効期限内であれば、その圧縮画像を見ることができる場合があります')
    expect(termsText).not.toContain('公開URL')
  })

  it('写真等の権利帰属：利用者または正当な権利者に帰属し、当社は所有権を取得せず、広告・宣伝に無断で使わない', () => {
    expect(termsText).toContain('写真等」）の権利は、利用者または正当な権利者に帰属します')
    expect(termsText).toContain('当社が、写真等の所有権を取得するものではありません')
    expect(termsText).toContain('保存、圧縮、表示、同期し、Excel台帳を作成します')
    expect(termsText).toContain('利用者の許可なく、写真等を広告や宣伝に使用しません')
  })

  it('データ削除：写真削除・工事案件削除（論理削除で端末内は残る）・ログアウト・退会機能が未実装であることを説明している', () => {
    expect(termsText).toContain('写真を削除')
    expect(termsText).toContain('「削除済み」として扱われます')
    expect(termsText).toContain('端末内の写真（原本・圧縮画像）は削除されず、そのまま残ります')
    expect(termsText).toContain('ログアウトしても、端末内の原本や写真・工事の情報は消えません')
    expect(termsText).toContain('アカウントの削除（退会）機能は、現在、アプリ内にありません')
  })

  it('免責は一方的な全面免除ではない（故意・重大な過失は除く／確認の責任は双方向に書く／強行法規の範囲では適用しない）', () => {
    expect(termsText).toContain('当社に故意または重大な過失がある場合を除き')
    expect(termsText).toContain('当社の責めに帰すべき事由によるものでない限り')
    expect(termsText).toContain('この条の規定は、法令により当社が責任を免れることができない場合には、その範囲では適用されません')
    expect(termsText).not.toMatch(/一切の責任を負いません|いかなる(場合|責任)も|損害賠償責任を(一切)?負いません/)
    // 一律の賠償上限額は設けない
    expect(termsText).not.toMatch(/賠償(額|の額)?は[^。]*(円|万円)を上限/)
  })

  it('準拠法は日本法。裁判管轄は専属的でなく、法令上の管轄・移送を妨げない', () => {
    expect(termsText).toContain('日本法に準拠し')
    expect(termsText).toContain('さいたま地方裁判所を第一審の合意管轄裁判所とします')
    expect(termsText).toContain('これは専属的な合意ではありません')
    expect(termsText).toContain('裁判所が法令に基づいて事件を他の裁判所へ移送することを妨げるものでもありません')
    expect(termsText).not.toContain('専属的合意管轄裁判所')
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

  it('クラウド画像の取得方法（認証付き通信・有効期限付きの署名URL）を、実装どおりに説明している', () => {
    expect(privacyText).toContain('認証付きの通信、または有効期限付きの署名URLを使って取得します')
    expect(privacyText).toContain('署名URLを知っている第三者は、有効期限内に、その圧縮画像を見ることができる場合があります')
    expect(privacyText).toContain('公開URLには依存していません')
    expect(privacyText).toContain('有効期限内であれば、その圧縮画像を取得できる可能性があります')
    expect(privacyText).not.toContain('公開URL方式')
  })

  it('実装と異なる説明（すべて非公開・第三者は閲覧できない・ポリシーの安全性を保証する表現）を書いていない', () => {
    for (const text of [privacyText, termsText]) {
      expect(text).not.toMatch(/第三者は(写真|画像|圧縮画像)を(閲覧|取得)できません|すべての写真は非公開|非公開で(す|保存)|閲覧できません|private|プライベート|完全に(安全|保護)|安全が保証/i)
    }
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

describe('運営者情報（確定した情報は通常の文章で、規約とポリシーで一致する）', () => {
  it('会社名・代表者・所在地が、運営者が確認した内容になっている', () => {
    expect(LEGAL.operatorName).toBe('株式会社ACE')
    expect(LEGAL.representative).toBe('代表取締役 茂木 克也')
    expect(LEGAL.postalCode).toBe('〒356-0004')
    expect(LEGAL.address).toBe('埼玉県ふじみ野市上福岡3-7-16')
    expect(LEGAL.serviceName).toBe('現場フォト')
    expect(LEGAL.operatorSiteUrl).toBe('https://ace-dx.jp/')
  })

  it('利用規約とプライバシーポリシーの両方に、同じ会社情報が表示される', () => {
    for (const text of [termsText, privacyText]) {
      expect(text).toContain('株式会社ACE')
      expect(text).toContain('代表取締役茂木克也')
      expect(text).toContain('〒356-0004埼玉県ふじみ野市上福岡3-7-16')
      expect(text).toContain('https://ace-dx.jp/')
    }
  })

  it('会社情報の表示は共通部品（OperatorInfo）で、2つの文書に会社情報を直接書いていない', () => {
    for (const file of ['src/pages/legal/TermsPage.tsx', 'src/pages/legal/PrivacyPage.tsx']) {
      const source = read(file)
      expect(source).toContain('<OperatorInfo />')
      expect(source).not.toMatch(/茂木|ふじみ野|356-0004|ace-dx\.jp/)
    }
  })

  it('確定した情報は、未確定（黄色）の表示ではなく通常の文章である', () => {
    for (const html of [terms, privacy]) {
      for (const value of ['代表取締役 茂木 克也', 'ふじみ野市上福岡3-7-16']) {
        const at = html.indexOf(value)
        expect(at).toBeGreaterThan(-1)
        const before = html.slice(0, at)
        // 直前の未確定の表示（data-legal-pending）は、すでに閉じている
        expect(before.lastIndexOf('data-legal-pending')).toBeLessThan(before.lastIndexOf('</span>'))
      }
    }
  })
})

describe('お問い合わせフォーム（確認済みのURLだけを使う）', () => {
  const CONTACT = 'https://ace-dx.jp/contact/'

  it('URLは AI事業サイトのお問い合わせページ（トップページや推測のURLではない）', () => {
    expect(LEGAL.contactFormUrl).toBe(CONTACT)
    expect(LEGAL.contactFormUrl).not.toBe(LEGAL.operatorSiteUrl)
  })

  it.each([
    ['利用規約', terms],
    ['プライバシーポリシー', privacy],
  ])('%s：お問い合わせフォームへのリンクは、別タブで開き、適切な rel 属性が付いている', (_name, html) => {
    const tags = [...html.matchAll(/<a [^>]*href="https:\/\/ace-dx\.jp\/contact\/"[^>]*>/g)].map((m) => m[0])
    expect(tags.length).toBeGreaterThan(0)
    for (const tag of tags) {
      expect(tag).toContain('target="_blank"')
      expect(tag).toMatch(/rel="[^"]*noopener[^"]*"/)
      expect(tag).toMatch(/rel="[^"]*noreferrer[^"]*"/)
    }
    expect(textOf(html)).toContain('お問い合わせフォーム')
  })

  it('利用規約 第9条・第15条、プライバシーポリシーの退会・開示・問い合わせの各項目に、フォームへのリンクがある', () => {
    const sectionOf = (html: string, title: string) => {
      const start = html.indexOf(title)
      expect(start).toBeGreaterThan(-1)
      return html.slice(start, html.indexOf('</section>', start))
    }
    const contactLink = 'href="https://ace-dx.jp/contact/"'
    expect(sectionOf(terms, '第15条')).toContain(contactLink)
    expect(sectionOf(terms, '第9条')).toContain(contactLink)
    expect(sectionOf(privacy, '10. 事業者の情報とお問い合わせ')).toContain(contactLink)
    expect(sectionOf(privacy, '9. 開示・訂正・削除などのご請求')).toContain(contactLink)
    expect(sectionOf(privacy, '8. データの保存と削除')).toContain(contactLink)
  })

  it('メールアドレスではなく、フォームのリンクに統一している（mailto・tel・メールアドレスなし）', () => {
    for (const html of [terms, privacy]) {
      expect(html).not.toMatch(/mailto:|tel:/)
      expect(decode(html.replace(/<[^>]+>/g, ' '))).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/)
    }
  })

  it('許可するリンク先は、運営者のAI事業サイトとそのお問い合わせページだけ', () => {
    for (const html of [terms, privacy]) {
      const urls = [...decode(html).matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => m[1])
      expect([...new Set(urls)].sort()).toEqual([LEGAL.operatorSiteUrl, CONTACT].sort())
    }
  })
})

describe('退会（アカウント削除）の案内', () => {
  it('フォームから連絡する案内になっていて、アプリ内機能が未実装であることも書いている', () => {
    for (const text of [termsText, privacyText]) {
      expect(text).toContain('アカウントの削除をご希望の場合は、お問い合わせフォームからご連絡ください')
      expect(text).toContain('削除の具体的な手順や時期は、現時点では定めていません')
    }
    expect(termsText).toContain('アカウントの削除（退会）機能は、現在、アプリ内にありません')
    expect(privacyText).toContain('現在、アプリ内に機能がありません')
  })

  it('実装されていない処理（即時削除・自動削除・期限内の削除）を保証する文章を書いていない', () => {
    const forbidden =
      /即時(に)?削除|直ちに削除|自動(的)?に(アカウントが)?削除され|(\d+|[一二三四五六七八九十]+)(日|営業日|週間|か月|ヶ月)以内に(必ず)?(アカウント)?(を)?削除|必ず削除|確実に削除|速やかに削除/
    for (const text of [termsText, privacyText]) expect(text).not.toMatch(forbidden)
  })
})

describe('未確定の項目（公開時に確定する情報・法的確認が必要な情報）', () => {
  const pendingKeys = (html: string) => [...html.matchAll(/data-legal-pending="(\w+)"/g)].map((m) => m[1])

  it('未確定の表示（LegalPending）は、規約にもポリシーにも残っていない', () => {
    expect(pendingKeys(terms)).toEqual([])
    expect(pendingKeys(privacy)).toEqual([])
    expect(terms).not.toContain(LEGAL_PENDING_MARK)
    expect(privacy).not.toContain(LEGAL_PENDING_MARK)
  })

  it('確定済みの項目（問い合わせ先・所在地・代表者・退会の受付窓口）は、未確定の一覧に含まれない', () => {
    for (const key of ['contact', 'operatorAddress', 'withdrawal', 'representative']) {
      expect(Object.keys(LEGAL_PENDING_ITEMS)).not.toContain(key)
    }
  })

  it('制定日・施行日は、正式公開日の2026年10月18日で確定している（これ以外の日付や仮置きの記号は書かない）', () => {
    expect(termsText).toContain('制定日・施行日：2026年10月18日')
    expect(privacyText).toContain('制定日：2026年10月18日')
    for (const text of [termsText, privacyText]) {
      expect([...new Set(text.match(/20\d\d年\d+月\d+日/g))]).toEqual(['2026年10月18日'])
      expect(text).not.toMatch(/○|〇|仮置き|YYYY|20xx/)
    }
  })

  it('裁判管轄・免責・開示等の手続きは確定した文章で、未確定の表示（LegalPending）にしていない', () => {
    for (const key of ['jurisdiction', 'liability', 'disclosure']) {
      expect(Object.keys(LEGAL_PENDING_ITEMS)).not.toContain(key)
      expect(pendingKeys(terms)).not.toContain(key)
      expect(pendingKeys(privacy)).not.toContain(key)
    }
    expect(terms).toContain('さいたま地方裁判所')
    expect(privacy).not.toContain('さいたま地方裁判所')
  })

  it('個人情報の開示等の請求：フォームで受け付け、メール以外も含む適切な方法で本人・代理権を確認し、手数料は原則無料', () => {
    expect(privacyText).toContain('利用者ご本人または正当な代理人からの、個人情報の開示、訂正、削除、利用停止等のご請求は、当社のお問い合わせフォームにて受け付けます')
    expect(privacyText).toContain('登録済みメールアドレスへの確認その他の適切な方法により、ご本人または代理権を確認したうえで、法令に従って対応します')
    expect(privacyText).toContain('本人確認ができない場合は、追加の確認をお願いすることがあります')
    expect(privacyText).toContain('確認が十分にできない間は、開示等を保留します')
    expect(privacyText).toContain('手数料は原則として無料です')
    expect(privacyText).toContain('法令により請求に応じられない場合は、法令に従って対応します')
    expect(privacyText).toContain('開示等を自動で行う機能はありません')
  })

  it('本人確認の条件を、メールだけ・原本写真の提出・同一ドメインに限定していない', () => {
    const section = privacyText.slice(privacyText.indexOf('9.開示・訂正・削除などのご請求'), privacyText.indexOf('10.事業者の情報'))
    expect(section).not.toMatch(/原本|ドメイン|のみ(で|に)?(本人|確認)/)
  })
})

describe('公開前の確認（npm run check:legal）', () => {
  const script = path.join(ROOT, 'scripts/check-legal-pending.mjs')

  it('未確定の項目が0件で、正常終了（終了コード0）する', () => {
    // 失敗（終了コード1）の場合は execFileSync が例外を投げるため、テストも失敗する
    const output = execFileSync(process.execPath, [script], { encoding: 'utf8' })
    expect(output).toContain('OK: 利用規約・プライバシーポリシーに、未確定の項目は残っていません。')
  })

  it('ビルドと自動テストの失敗条件にはしていない（package.json の build / test に組み込まれていない）', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>
    expect(scripts['check:legal']).toBe('node scripts/check-legal-pending.mjs')
    for (const name of ['build', 'test', 'dev', 'preview']) expect(scripts[name]).not.toMatch(/check:legal|check-legal/)
  })
})
