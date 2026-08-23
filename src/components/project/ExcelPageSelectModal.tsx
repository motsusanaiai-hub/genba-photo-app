import { useState } from 'react'
import type { ExcelPageInfo } from '@/lib/generateExcel'
import { EXCEL_PAGE_LIMIT_MESSAGE } from '@/lib/plan'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Props<T> {
  pages: ExcelPageInfo<T>[]
  /** 選択肢1件分の表示文言。実際に使われるページ情報（startNo/endNo等）から作る。UI専用の番号再計算はしない。 */
  formatLabel: (page: ExcelPageInfo<T>, index: number) => string
  onSelect: (page: ExcelPageInfo<T>) => void
  onCancel: () => void
}

/**
 * Free / ads_removed 向けのExcelページ選択モーダル。
 * 標準・大写真・施工前後の3レイアウトで共通利用する
 * （表示文言だけformatLabelで呼び出し側が調整する）。
 */
export function ExcelPageSelectModal<T>({ pages, formatLabel, onSelect, onCancel }: Props<T>) {
  const [selectedIndex, setSelectedIndex] = useState(0)

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center lg:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative bg-background w-full max-w-md rounded-t-2xl lg:rounded-2xl shadow-xl pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="px-4 pt-4 pb-3 border-b">
          <p className="text-sm font-semibold">出力するページを選択</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{EXCEL_PAGE_LIMIT_MESSAGE}</p>
        </div>

        <div className="py-1 max-h-[50vh] overflow-y-auto">
          {pages.map((page, i) => (
            <button
              key={i}
              onClick={() => setSelectedIndex(i)}
              className={cn(
                'w-full flex items-center gap-3 px-4 py-3 text-sm text-left transition-colors',
                i === selectedIndex ? 'bg-primary/5' : 'hover:bg-muted',
              )}
            >
              <span
                className={cn(
                  'h-4 w-4 rounded-full border-2 shrink-0',
                  i === selectedIndex ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                )}
              />
              {formatLabel(page, i)}
            </button>
          ))}
        </div>

        <div className="flex gap-2 border-t px-4 py-3">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            キャンセル
          </Button>
          <Button className="flex-1" onClick={() => onSelect(pages[selectedIndex])}>
            このページを出力
          </Button>
        </div>
      </div>
    </div>
  )
}
