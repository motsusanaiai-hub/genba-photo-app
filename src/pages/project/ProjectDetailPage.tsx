import { useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Camera, Pencil, Plus } from 'lucide-react'
import { useProjects } from '@/hooks/useProjects'
import { usePhotos } from '@/hooks/usePhotos'
import { Header } from '@/components/layout/Header'
import { PhotoGrid } from '@/components/photo/PhotoGrid'
import { PhotoUploadModal } from '@/components/photo/PhotoUploadModal'
import { PhotoLightbox } from '@/components/photo/PhotoLightbox'
import { PhaseBadge } from '@/components/photo/PhaseBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'

type PhaseFilter = 'all' | Phase

const TABS: { value: PhaseFilter; label: string }[] = [
  { value: 'all',    label: '全て' },
  { value: 'before', label: PHASE_CONFIG.before.label },
  { value: 'during', label: PHASE_CONFIG.during.label },
  { value: 'after',  label: PHASE_CONFIG.after.label },
]

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject } = useProjects()
  const { photos, filtered, removePhoto } = usePhotos(projectId ?? '')

  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all')
  const [showUpload, setShowUpload] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null)

  const project = getProject(projectId ?? '')
  if (!project) return <Navigate to="/" replace />

  const displayPhotos = filtered(phaseFilter)

  const phaseCount = (phase: Phase) => photos.filter((p) => p.phase === phase).length

  return (
    <>
      <Header
        title={project.name}
        left={
          <Button variant="ghost" size="icon" onClick={() => navigate('/')}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
        }
        right={
          <div className="flex items-center gap-1">
            {/* PC: 写真追加ボタン */}
            <Button
              size="sm"
              className="hidden lg:flex gap-1.5"
              onClick={() => setShowUpload(true)}
            >
              <Plus className="h-4 w-4" />
              写真を追加
            </Button>
            {/* 編集ボタン */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate(`/projects/${projectId}/edit`)}
              aria-label="プロジェクトを編集"
            >
              <Pencil className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {/* フェーズフィルタータブ */}
      <div className="border-b bg-background sticky top-14 z-30">
        <div className="flex overflow-x-auto">
          {TABS.map(({ value, label }) => {
            const count = value === 'all' ? photos.length : phaseCount(value as Phase)
            return (
              <button
                key={value}
                onClick={() => setPhaseFilter(value)}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors shrink-0',
                  phaseFilter === value
                    ? 'border-primary text-foreground font-medium'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {value !== 'all' ? (
                  <PhaseBadge phase={value as Phase} size="sm" />
                ) : (
                  <span>{label}</span>
                )}
                <span className="text-xs text-muted-foreground">（{count}）</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* コンテンツ */}
      {photos.length === 0 ? (
        <PhotoEmptyState onUpload={() => setShowUpload(true)} />
      ) : displayPhotos.length === 0 ? (
        <FilterEmptyState phase={phaseFilter as Phase} onClear={() => setPhaseFilter('all')} />
      ) : (
        <PhotoGrid photos={displayPhotos} onPhotoClick={setLightboxPhoto} />
      )}

      {/* スマホ用 FAB */}
      <button
        onClick={() => setShowUpload(true)}
        className="lg:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all"
        aria-label="写真を追加"
      >
        <Camera className="h-6 w-6" />
      </button>

      {/* アップロードモーダル */}
      <PhotoUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={projectId ?? ''}
      />

      {/* ライトボックス */}
      {lightboxPhoto && (
        <PhotoLightbox
          photo={lightboxPhoto}
          photos={displayPhotos}
          onClose={() => setLightboxPhoto(null)}
          onChange={setLightboxPhoto}
          onDelete={async (photoId) => {
            await removePhoto(photoId)
            // ライトボックス側で次の写真へ移動 or 閉じる処理を行う
          }}
        />
      )}
    </>
  )
}

function PhotoEmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] gap-4 text-center p-4">
      <div className="rounded-full bg-muted p-6">
        <Camera className="h-10 w-10 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h2 className="text-base font-semibold">写真がまだありません</h2>
        <p className="text-sm text-muted-foreground max-w-xs">
          写真をアップロードして施工記録を作成しましょう
        </p>
      </div>
      <Button onClick={onUpload}>
        <Plus className="h-4 w-4" />
        写真を追加
      </Button>
    </div>
  )
}

function FilterEmptyState({ phase, onClear }: { phase: Phase; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3 text-center p-4">
      <p className="text-muted-foreground text-sm">
        <PhaseBadge phase={phase} size="sm" /> の写真はまだありません
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        全て表示
      </Button>
    </div>
  )
}
