import type { HouseAd } from '@/lib/houseAds'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props {
  ad: HouseAd
}

/**
 * 自社広告のカード。カード全体が1つのリンクで、新しいタブで開く。
 *
 * - テキストとCSSだけで描画し、画像・外部スクリプトは読み込まない
 *   （通信環境や広告ブロッカーの影響を受けず、表示によるレイアウトのずれも起きない）。
 * - 広告ブロッカーの要素非表示ルールに掛かりやすい ad / ads 等のクラス名・IDは付けない
 *   （隠されたとしてもアプリの操作には影響しない）。
 * - 「広告」ラベルと広告主名を常に表示し、広告であることを明示する。
 * - ボタンはリンクの中に置くため <button> ではなく見た目だけボタンにした <span>（リンクの入れ子を避ける）。
 */
export function HouseAdCard({ ad }: Props) {
  return (
    <a
      href={ad.url}
      target="_blank"
      rel="noopener noreferrer sponsored"
      className="block rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="shrink-0 rounded border px-1 font-medium">広告</span>
            <span className="truncate">
              {ad.advertiser}・{ad.service}
            </span>
          </span>
          <span className="block text-sm font-semibold leading-snug">{ad.headline}</span>
          <span className="block text-xs leading-relaxed text-muted-foreground line-clamp-2">{ad.description}</span>
        </span>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0 self-start text-xs sm:self-center')}>
          {ad.cta}
        </span>
      </span>
      <span className="sr-only">（新しいタブで開きます）</span>
    </a>
  )
}
