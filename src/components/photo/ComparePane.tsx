import type { Photo } from '@/types/photo'
import { ALL_PHASE_KEYS, PHASE_KEY_ACTIVE_CLASS, PHASE_KEY_LABEL, filterByPhaseKey, type PhaseKey } from '@/types/photo'
import { cn } from '@/lib/utils'
import { LedgerView } from './LedgerView'

interface Props {
  phase: PhaseKey
  onPhaseChange: (phase: PhaseKey) => void
  photos: Photo[]  // プロジェクト全写真。内部で phase によりフィルタする
  onPhotoClick: (photo: Photo) => void
  onCommentChange: (photoId: string, comment: string) => void
  onFloorLocationChange: (photoId: string, data: { floor: string; location: string }) => void
  onReorder: (orderedIds: string[]) => void
}

/**
 * 比較・並び替えモードの1ペイン分。左右どちらでも使う共通コンポーネント。
 * 将来的な「前後比較」「未分類整理」等の追加モードもこのコンポーネントの再利用で対応する想定。
 */
export function ComparePane({
  phase,
  onPhaseChange,
  photos,
  onPhotoClick,
  onCommentChange,
  onFloorLocationChange,
  onReorder,
}: Props) {
  const filtered = filterByPhaseKey(photos, phase)

  return (
    <div>
      {/* フェーズタブ */}
      <div className="flex overflow-x-auto gap-1.5 px-2 py-2 border-b bg-background">
        {ALL_PHASE_KEYS.map((key) => {
          const count = filterByPhaseKey(photos, key).length
          const active = phase === key
          return (
            <button
              key={key}
              onClick={() => onPhaseChange(key)}
              aria-pressed={active}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors shrink-0 whitespace-nowrap',
                active ? PHASE_KEY_ACTIVE_CLASS[key] : 'border-transparent text-muted-foreground opacity-50 hover:opacity-80',
              )}
            >
              <span>{PHASE_KEY_LABEL[key]}</span>
              <span className="text-xs">（{count}）</span>
            </button>
          )
        })}
      </div>

      {/* 写真リスト */}
      {filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground text-center px-4">
          {PHASE_KEY_LABEL[phase]}の写真はありません
        </div>
      ) : (
        <LedgerView
          photos={filtered}
          onPhotoClick={onPhotoClick}
          onCommentChange={onCommentChange}
          onFloorLocationChange={onFloorLocationChange}
          onReorder={onReorder}
        />
      )}
    </div>
  )
}
