import { PHASE_CONFIG, type Phase } from '@/types/photo'
import { cn } from '@/lib/utils'

interface Props {
  phase: Phase | null
  size?: 'sm' | 'md'
  className?: string
}

export function PhaseBadge({ phase, size = 'sm', className }: Props) {
  if (!phase) return null
  const { label, badgeClass } = PHASE_CONFIG[phase]
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-medium border border-transparent',
        size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2.5 py-1',
        badgeClass,
        className,
      )}
    >
      {label}
    </span>
  )
}
