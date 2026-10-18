import { useEffect, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { LEGAL, LEGAL_PENDING_ITEMS, LEGAL_PENDING_MARK, type LegalPendingKey } from '@/lib/legalInfo'

/**
 * 利用規約・プライバシーポリシーの共通レイアウト。
 * ログイン不要の公開ページで、認証ストアや Supabase には一切触れない（未ログインでも、直接URLを開いても表示できる）。
 * 通常のテキスト表示のみ（印刷・コピーができる）。幅は最大 max-w-2xl、スマホでは左右16pxの余白で折り返す。
 */
export function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  const { hash } = useLocation()

  // /privacy#xxx のように、見出しの位置を直接開けるようにする。
  useEffect(() => {
    const id = decodeURIComponent(hash.replace(/^#/, ''))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [hash])

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/95 print:hidden">
        <div className="mx-auto flex h-12 max-w-2xl items-center px-4">
          <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            {LEGAL.serviceName}へ戻る
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl break-words px-4 pb-16 pt-6 text-sm leading-relaxed">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {children}
      </main>

      <footer className="border-t print:hidden">
        <nav className="mx-auto flex max-w-2xl flex-wrap gap-x-4 gap-y-1 px-4 py-4 text-xs text-muted-foreground" aria-label="規約">
          <Link to="/terms" className="hover:text-foreground hover:underline">利用規約</Link>
          <Link to="/privacy" className="hover:text-foreground hover:underline">プライバシーポリシー</Link>
        </nav>
      </footer>
    </div>
  )
}

/** 見出し付きの1区分。id を付けると /privacy#id で直接開ける。 */
export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="mt-8 scroll-mt-16">
      <h2 className="mb-2 border-l-4 border-primary pl-2 text-base font-semibold">{title}</h2>
      <div className="space-y-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  )
}

/** 冒頭の要点（短い要約）を目立たせる枠。 */
export function LegalSummary({ children }: { children: ReactNode }) {
  return <div className="mt-4 space-y-1 rounded-lg border bg-muted/40 p-3 text-sm">{children}</div>
}

/**
 * 運営者がまだ決めていない項目の表示。公開前に、このコンポーネントごと本文へ差し替える。
 * 文字列の先頭は LEGAL_PENDING_MARK 固定（公開前に検索して残りを確認できる）。
 */
export function LegalPending({ item, note }: { item: LegalPendingKey; note?: string }) {
  return (
    <span data-legal-pending={item} className="rounded bg-amber-100 px-1 font-medium text-amber-900">
      {LEGAL_PENDING_MARK}：{LEGAL_PENDING_ITEMS[item]}
      {note ? `（${note}）` : ''}。公開前に確定して差し替え】
    </span>
  )
}

/** お問い合わせフォームへのリンク（別タブで開く）。問い合わせ・退会の受付窓口。 */
export function ContactFormLink() {
  return (
    <a href={LEGAL.contactFormUrl} target="_blank" rel="noopener noreferrer" className="underline">
      {LEGAL.contactFormLabel}
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  )
}

/**
 * 運営者の情報（利用規約とプライバシーポリシーで共通）。会社情報は legalInfo.ts の値だけを表示するため、
 * 2つの文書で必ず一致する。
 */
export function OperatorInfo() {
  return (
    <ul>
      <li>運営者：{LEGAL.operatorName}</li>
      <li>代表者：{LEGAL.representative}</li>
      <li>
        所在地：{LEGAL.postalCode} {LEGAL.address}
      </li>
      <li>
        お問い合わせ：<ContactFormLink />
      </li>
      <li>
        運営者のAI事業サイト（{LEGAL.operatorSiteName}）：
        <a href={LEGAL.operatorSiteUrl} target="_blank" rel="noopener noreferrer" className="underline">
          {LEGAL.operatorSiteUrl}
        </a>
      </li>
    </ul>
  )
}
