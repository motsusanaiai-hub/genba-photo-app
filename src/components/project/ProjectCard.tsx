import { Camera, Pencil, Trash2, MapPin } from 'lucide-react'
import type { ProjectWithCount } from '@/types/project'
import { formatRelativeDate } from '@/utils/dateUtils'

const COVER_GRADIENTS = [
  'from-blue-400 to-blue-600',
  'from-emerald-400 to-emerald-600',
  'from-amber-400 to-amber-600',
  'from-purple-400 to-purple-600',
  'from-rose-400 to-rose-600',
  'from-orange-400 to-orange-600',
  'from-teal-400 to-teal-600',
  'from-indigo-400 to-indigo-600',
]

function getCoverGradient(name: string): string {
  let hash = 0
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffff
  return COVER_GRADIENTS[hash % COVER_GRADIENTS.length]
}

interface Props {
  project: ProjectWithCount
  onClick: () => void
  onEdit: () => void
  onDelete: () => void
}

export function ProjectCard({ project, onClick, onEdit, onDelete }: Props) {
  const gradient = getCoverGradient(project.name)

  return (
    <div
      className="group rounded-lg border bg-card shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
      onClick={onClick}
    >
      {/* カバー（写真なしはグラデーションプレースホルダー） */}
      <div
        className={`aspect-video bg-gradient-to-br ${gradient} flex items-center justify-center`}
      >
        <span className="text-white text-5xl font-bold opacity-40 select-none">
          {project.name[0]}
        </span>
      </div>

      {/* コンテンツ */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm leading-snug line-clamp-2 flex-1 min-w-0">
            {project.name}
          </h3>

          {/* アクションボタン: モバイルは常時表示、PC はホバー時 */}
          <div
            className="flex gap-0.5 shrink-0 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={onEdit}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="編集"
            >
              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded hover:bg-muted transition-colors"
              aria-label="削除"
            >
              <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {project.location && (
          <p className="flex items-center gap-1 text-xs text-muted-foreground mt-1 truncate">
            <MapPin className="h-3 w-3 shrink-0" />
            {project.location}
          </p>
        )}

        <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
          <Camera className="h-3 w-3 shrink-0" />
          <span>{project.photo_count}枚</span>
          <span className="text-border">·</span>
          <span>{formatRelativeDate(project.updated_at)}</span>
        </div>
      </div>
    </div>
  )
}
