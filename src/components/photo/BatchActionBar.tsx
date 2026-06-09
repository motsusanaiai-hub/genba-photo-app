import { X } from 'lucide-react'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import { cn } from '@/lib/utils'

const PHASES: { value: Phase; label: string }[] = [
  { value: 'before', label: PHASE_CONFIG.before.label },
  { value: 'during', label: PHASE_CONFIG.during.label },
  { value: 'after',  label: PHASE_CONFIG.after.label },
]

interface Props {
  count: number
  onPhaseChange: (phase: Phase) => void
  onClear: () => void
}

export function BatchActionBar({ count, onPhaseChange, onClear }: Props) {
  if (count === 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t shadow-lg safe-area-bottom">
      <div className="flex items-center gap-3 px-4 py-3 max-w-2xl mx-auto">
        <span className="text-sm font-medium text-muted-foreground shrink-0 min-w-[4rem]">
          {count}枚選択
        </span>

        <div className="flex gap-1.5 flex-1">
          {PHASES.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onPhaseChange(value)}
              className={cn(
                'flex-1 py-2 rounded-lg border text-xs font-medium transition-colors',
                'hover:bg-muted active:scale-95',
                value === 'before' && 'border-blue-300  text-blue-700  hover:bg-blue-50',
                value === 'during' && 'border-amber-300 text-amber-700 hover:bg-amber-50',
                value === 'after'  && 'border-green-300 text-green-700 hover:bg-green-50',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={onClear}
          className="p-1.5 rounded-full hover:bg-muted transition-colors shrink-0"
          aria-label="選択解除"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>
    </div>
  )
}
