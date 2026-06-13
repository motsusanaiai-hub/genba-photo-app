import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { PHASE_CONFIG, PHASE_OPTIONS, type Phase } from '@/types/photo'
import { cn } from '@/lib/utils'

const AUTO_DISMISS_MS = 4000
const CHANGED_DISMISS_MS = 1800

function phaseLabel(phase: Phase | null): string {
  return phase ? PHASE_CONFIG[phase].label : '未分類'
}

interface Props {
  phase: Phase | null
  onChangePhase: (phase: Phase | null) => void
  onDismiss: () => void
}

/** 撮影直後に表示する「○○に保存しました」トースト。タップで保存先を変更できる */
export function PhaseSaveToast({ phase, onChangePhase, onDismiss }: Props) {
  const [mode, setMode] = useState<'confirm' | 'expanded' | 'changed'>('confirm')
  const [currentPhase, setCurrentPhase] = useState(phase)

  useEffect(() => {
    if (mode === 'expanded') return
    const ms = mode === 'changed' ? CHANGED_DISMISS_MS : AUTO_DISMISS_MS
    const timer = setTimeout(onDismiss, ms)
    return () => clearTimeout(timer)
  }, [mode, onDismiss])

  const handleSelect = (newPhase: Phase | null) => {
    setCurrentPhase(newPhase)
    onChangePhase(newPhase)
    setMode('changed')
  }

  return (
    <div className="lg:hidden fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[max(0.5rem,env(safe-area-inset-top))] pointer-events-none">
      <div className="pointer-events-auto bg-neutral-900/95 text-white rounded-2xl shadow-lg w-full max-w-xs overflow-hidden">
        {mode === 'expanded' ? (
          <div className="px-4 py-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">保存先を変更</span>
              <button onClick={onDismiss} className="text-white/60 hover:text-white" aria-label="閉じる">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex gap-1.5">
              {PHASE_OPTIONS.map(({ value, label }) => (
                <button
                  key={label}
                  onClick={() => handleSelect(value)}
                  className={cn(
                    'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors active:scale-95',
                    value === currentPhase ? 'bg-white text-neutral-900' : 'bg-white/10 hover:bg-white/20',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4 py-2.5 text-sm">
            <Check className="h-4 w-4 text-green-400 shrink-0" />
            <span className="flex-1">
              {phaseLabel(currentPhase)}に{mode === 'changed' ? '変更' : '保存'}しました
            </span>
            {mode === 'confirm' && (
              <button
                onClick={() => setMode('expanded')}
                className="text-white/70 hover:text-white text-xs font-medium underline underline-offset-2 shrink-0"
              >
                変更
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
