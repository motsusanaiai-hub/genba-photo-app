import { useEffect, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Camera, Pencil, Plus, LayoutGrid, List } from 'lucide-react'
import { ExportButton } from '@/components/project/ExportButton'
import { BeforeAfterExportButton } from '@/components/project/BeforeAfterExportButton'
import { useProjects } from '@/hooks/useProjects'
import { usePhotos } from '@/hooks/usePhotos'
import { usePhotoSelection } from '@/hooks/usePhotoSelection'
import { Header } from '@/components/layout/Header'
import { PhotoGrid } from '@/components/photo/PhotoGrid'
import { LedgerView } from '@/components/photo/LedgerView'
import { BatchActionBar } from '@/components/photo/BatchActionBar'
import { PhotoUploadModal } from '@/components/photo/PhotoUploadModal'
import { PhotoLightbox } from '@/components/photo/PhotoLightbox'
import { PhaseBadge } from '@/components/photo/PhaseBadge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'

type PhaseFilter = 'all' | Phase | 'unclassified'
type ViewMode = 'grid' | 'ledger'

const TABS: { value: PhaseFilter; label: string }[] = [
  { value: 'all',          label: '全て' },
  { value: 'before',       label: PHASE_CONFIG.before.label },
  { value: 'during',       label: PHASE_CONFIG.during.label },
  { value: 'after',        label: PHASE_CONFIG.after.label },
  { value: 'unclassified', label: '未分類' },
]

const VIEW_MODE_KEY = 'genba-view-mode'

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject } = useProjects()
  const { photos, filtered, removePhoto, setComment, setPhase, swapPhotoOrder } = usePhotos(projectId ?? '')
  const { selected, toggle, clear } = usePhotoSelection()

  const hasBeforeAfter =
    photos.some((p) => p.phase === 'before') &&
    photos.some((p) => p.phase === 'after')

  const [phaseFilter, setPhaseFilter] = useState<PhaseFilter>('all')
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'grid',
  )
  const [showUpload, setShowUpload] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null)

  const project = getProject(projectId ?? '')

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  if (!project) return <Navigate to="/" replace />

  const displayPhotos = filtered(phaseFilter)

  const handlePhaseFilterChange = (phase: PhaseFilter) => {
    setPhaseFilter(phase)
    clear()
  }

  const handleBatchPhaseChange = (phase: Phase | null) => {
    selected.forEach((id) => setPhase(id, phase))
    clear()
  }

  // displayPhotos ベースで隣接判定 → フィルター中も正しく並び替えられる
  const handleMovePhoto = (photoId: string, direction: 'up' | 'down') => {
    const idx = displayPhotos.findIndex((p) => p.id === photoId)
    if (direction === 'up' && idx <= 0) return
    if (direction === 'down' && idx >= displayPhotos.length - 1) return
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1
    swapPhotoOrder(displayPhotos[idx].id, displayPhotos[swapIdx].id)
  }

  const phaseCount = (phase: Phase) => photos.filter((p) => p.phase === phase).length
  const unclassifiedCount = photos.filter((p) => p.phase == null).length

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
            {/* Excel出力ボタン（写真が1枚以上ある場合のみ表示） */}
            {photos.length > 0 && (
              <ExportButton project={project} photos={photos} />
            )}
            {/* 施工前後テンプレート（before / after が各1枚以上ある場合のみ表示） */}
            {hasBeforeAfter && (
              <BeforeAfterExportButton project={project} photos={photos} />
            )}
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

      {/* フェーズフィルタータブ + ビュー切り替え */}
      <div className="border-b bg-background sticky top-14 z-30">
        <div className="flex items-center">
          {/* フェーズタブ */}
          <div className="flex overflow-x-auto flex-1">
            {TABS.map(({ value, label }) => {
              const count =
                value === 'all'          ? photos.length :
                value === 'unclassified' ? unclassifiedCount :
                                           phaseCount(value as Phase)
              return (
                <button
                  key={value}
                  onClick={() => handlePhaseFilterChange(value)}
                  className={cn(
                    'flex items-center gap-1.5 px-4 py-3 text-sm whitespace-nowrap border-b-2 transition-colors shrink-0',
                    phaseFilter === value
                      ? 'border-primary text-foreground font-medium'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  {value === 'all' || value === 'unclassified' ? (
                    <span>{label}</span>
                  ) : (
                    <PhaseBadge phase={value as Phase} size="sm" />
                  )}
                  <span className="text-xs text-muted-foreground">（{count}）</span>
                </button>
              )
            })}
          </div>

          {/* ビュー切り替えボタン */}
          <div className="flex items-center gap-0.5 px-2 shrink-0 border-l ml-1">
            <button
              onClick={() => setViewMode('grid')}
              className={cn(
                'p-1.5 rounded transition-colors',
                viewMode === 'grid'
                  ? 'text-foreground bg-muted'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="グリッド表示"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setViewMode('ledger')}
              className={cn(
                'p-1.5 rounded transition-colors',
                viewMode === 'ledger'
                  ? 'text-foreground bg-muted'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="台帳表示"
              aria-pressed={viewMode === 'ledger'}
            >
              <List className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* コンテンツ */}
      {photos.length === 0 ? (
        <PhotoEmptyState onUpload={() => setShowUpload(true)} />
      ) : displayPhotos.length === 0 ? (
        <FilterEmptyState phase={phaseFilter as Phase | 'unclassified'} onClear={() => handlePhaseFilterChange('all')} />
      ) : viewMode === 'ledger' ? (
        <LedgerView
          photos={displayPhotos}
          onPhotoClick={setLightboxPhoto}
          onCommentChange={setComment}
          onMovePhoto={handleMovePhoto}
        />
      ) : (
        <PhotoGrid
          photos={displayPhotos}
          onPhotoClick={setLightboxPhoto}
          selectedIds={selected}
          onToggle={toggle}
        />
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
          }}
        />
      )}

      {/* 一括フェーズ変更バー */}
      <BatchActionBar
        count={selected.size}
        onPhaseChange={handleBatchPhaseChange}
        onClear={clear}
      />
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

function FilterEmptyState({ phase, onClear }: { phase: Phase | 'unclassified'; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3 text-center p-4">
      <p className="text-muted-foreground text-sm">
        {phase === 'unclassified' ? (
          '未分類'
        ) : (
          <PhaseBadge phase={phase} size="sm" />
        )}
        {' '}の写真はまだありません
      </p>
      <Button variant="outline" size="sm" onClick={onClear}>
        全て表示
      </Button>
    </div>
  )
}
