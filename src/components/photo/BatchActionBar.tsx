import { FolderInput } from 'lucide-react'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import { cn } from '@/lib/utils'

const PHASES: { value: Phase | null; label: string }[] = [
  { value: 'before', label: PHASE_CONFIG.before.label },
  { value: 'during', label: PHASE_CONFIG.during.label },
  { value: 'after',  label: PHASE_CONFIG.after.label },
  { value: null,     label: '未分類' },
]

interface Props {
  count: number
  onPhaseChange: (phase: Phase | null) => void
  onClear: () => void
  // 未分類タブ表示中のみ渡される（施工前/中/後にはフォルダ概念を持ち込まないため）
  onMoveToFolder?: () => void
}

export function BatchActionBar({ count, onPhaseChange, onClear, onMoveToFolder }: Props) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[55] bg-background border-t shadow-lg safe-area-bottom">
      <div className="flex flex-col gap-2 px-4 py-3 max-w-2xl mx-auto">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-muted-foreground shrink-0 min-w-[4rem]">
            {count}枚選択
          </span>

          <div className="flex gap-1.5 flex-1">
            {PHASES.map(({ value, label }) => (
              <button
                key={value ?? 'unclassified'}
                onClick={() => onPhaseChange(value)}
                className={cn(
                  'flex-1 py-2 rounded-lg border text-xs font-medium transition-colors',
                  'hover:bg-muted active:scale-95',
                  value === 'before' && 'border-blue-300  text-blue-700  hover:bg-blue-50',
                  value === 'during' && 'border-amber-300 text-amber-700 hover:bg-amber-50',
                  value === 'after'  && 'border-green-300 text-green-700 hover:bg-green-50',
                  value === null     && 'border-gray-300  text-gray-600  hover:bg-gray-50',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={onClear}
            className="shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted active:scale-95 transition-colors"
          >
            選択解除
          </button>
        </div>

        {/* フォルダへ移動（未分類タブ表示中のみ） */}
        {onMoveToFolder && (
          <button
            onClick={onMoveToFolder}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border border-dashed text-xs font-medium text-muted-foreground hover:bg-muted active:scale-95 transition-colors"
          >
            <FolderInput className="h-3.5 w-3.5" />
            フォルダへ移動
          </button>
        )}
      </div>
    </div>
  )
}
