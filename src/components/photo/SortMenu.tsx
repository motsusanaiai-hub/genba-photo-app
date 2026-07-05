import { useState } from 'react'
import { ArrowUpDown, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { SORT_MODE_OPTIONS, type SortMode } from '@/utils/photoSort'
import { cn } from '@/lib/utils'

interface Props {
  /** 並び替え条件が選ばれ、確認ダイアログで実行が確定した時に呼ばれる */
  onSort: (mode: SortMode) => void
}

/**
 * 「並び替え」ドロップダウン。並び替え対象の一覧や保存処理は呼び出し側が持つため、
 * 台帳・比較モードのどちらからも同じ見た目・同じ確認フローで使い回せる汎用コンポーネント。
 */
export function SortMenu({ onSort }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<SortMode | null>(null)

  const close = () => {
    setOpen(false)
    setPending(null)
  }

  const handleConfirm = () => {
    if (!pending) return
    onSort(pending)
    close()
  }

  const pendingOption = SORT_MODE_OPTIONS.find((o) => o.value === pending)

  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        className="gap-1"
        aria-label="並び替えメニューを開く"
        aria-expanded={open}
      >
        <ArrowUpDown className="h-4 w-4" />
        <span className="hidden sm:inline">並び替え</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <>
          {/* 背景クリックで閉じる */}
          <div className="fixed inset-0 z-[70]" onClick={close} />
          <div className="absolute right-0 top-full mt-1 z-[71] bg-background border rounded-xl shadow-lg overflow-hidden w-64">
            {pendingOption ? (
              <div className="p-3 space-y-3">
                <p className="text-sm leading-snug">
                  現在の手動並び順を<span className="font-medium">{pendingOption.label}</span>
                  で並び替えます。よろしいですか？
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setPending(null)}>
                    キャンセル
                  </Button>
                  <Button size="sm" className="flex-1" onClick={handleConfirm}>
                    はい
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <p className="px-3 pt-2.5 pb-1 text-xs text-muted-foreground font-medium">並び替え条件を選択</p>
                {SORT_MODE_OPTIONS.map(({ value, label, description }) => (
                  <button
                    key={value}
                    onClick={() => setPending(value)}
                    className="w-full flex flex-col items-start gap-0.5 px-3 py-2.5 text-left hover:bg-muted transition-colors"
                  >
                    <span className="text-sm font-medium leading-tight">{label}</span>
                    <span className="text-xs text-muted-foreground leading-tight">{description}</span>
                  </button>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
