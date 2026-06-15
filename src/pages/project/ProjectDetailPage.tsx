import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Camera, ImagePlus, Layers, Pencil, Plus, LayoutGrid, List } from 'lucide-react'
import { ExportButton } from '@/components/project/ExportButton'
import { BeforeAfterExportButton } from '@/components/project/BeforeAfterExportButton'
import { LargePhotoExportButton } from '@/components/project/LargePhotoExportButton'
import { ZipExportButton } from '@/components/project/ZipExportButton'
import { useProjects } from '@/hooks/useProjects'
import { usePhotos } from '@/hooks/usePhotos'
import { usePhotoSelection } from '@/hooks/usePhotoSelection'
import { Header } from '@/components/layout/Header'
import { PhotoGrid, type GridSize } from '@/components/photo/PhotoGrid'
import { LedgerView } from '@/components/photo/LedgerView'
import { BatchActionBar } from '@/components/photo/BatchActionBar'
import { PhotoUploadModal } from '@/components/photo/PhotoUploadModal'
import { OverlayCaptureModal } from '@/components/photo/OverlayCaptureModal'
import { PhotoLightbox } from '@/components/photo/PhotoLightbox'
import { PhaseSaveToast } from '@/components/photo/PhaseSaveToast'
import { PhotoActionSheet } from '@/components/photo/PhotoActionSheet'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PHASE_CONFIG, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'

type ViewMode = 'grid' | 'ledger'
type PhaseKey = Phase | 'unclassified'

const ALL_PHASE_KEYS: PhaseKey[] = ['before', 'during', 'after', 'unclassified']

const PHASE_VISIBILITY_ITEMS: { key: PhaseKey; label: string; activeClass: string }[] = [
  { key: 'before',       label: PHASE_CONFIG.before.label, activeClass: 'bg-blue-100 text-blue-700 border-blue-300' },
  { key: 'during',       label: PHASE_CONFIG.during.label, activeClass: 'bg-amber-100 text-amber-700 border-amber-300' },
  { key: 'after',        label: PHASE_CONFIG.after.label,  activeClass: 'bg-green-100 text-green-700 border-green-300' },
  { key: 'unclassified', label: '未分類',                   activeClass: 'bg-gray-200 text-gray-700 border-gray-400' },
]

const GRID_SIZES: { value: GridSize; label: string }[] = [
  { value: 'large',  label: '大' },
  { value: 'medium', label: '中' },
  { value: 'small',  label: '小' },
]

const VIEW_MODE_KEY = 'genba-view-mode'
const GRID_SIZE_KEY = 'genba-grid-size'
const PHASE_VISIBILITY_KEY = 'genba-phase-visibility'

function loadVisiblePhases(): Set<PhaseKey> {
  try {
    const raw = localStorage.getItem(PHASE_VISIBILITY_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) {
        const keys = parsed.filter((k): k is PhaseKey => ALL_PHASE_KEYS.includes(k as PhaseKey))
        if (keys.length > 0) return new Set(keys)
      }
    }
  } catch {
    // 不正なデータは無視してデフォルトへ
  }
  return new Set(ALL_PHASE_KEYS)
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>()
  const navigate = useNavigate()
  const { getProject } = useProjects()
  const { photos, removePhoto, setComment, setFloorLocation, setPhase, swapPhotoOrder, uploadPhotos } = usePhotos(projectId ?? '')
  const { selected, toggle, selectRange, clear } = usePhotoSelection()

  const beforePhotos = photos.filter((p) => p.phase === 'before')
  const hasBeforeAfter =
    beforePhotos.length > 0 &&
    photos.some((p) => p.phase === 'after')

  const [visiblePhases, setVisiblePhases] = useState<Set<PhaseKey>>(loadVisiblePhases)
  const [viewMode, setViewMode] = useState<ViewMode>(
    () => (localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null) ?? 'grid',
  )
  const [gridSize, setGridSize] = useState<GridSize>(
    () => (localStorage.getItem(GRID_SIZE_KEY) as GridSize | null) ?? 'large',
  )
  const [showUpload, setShowUpload] = useState(false)
  const [showOverlayCapture, setShowOverlayCapture] = useState(false)
  const [lightboxPhoto, setLightboxPhoto] = useState<Photo | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [captureToast, setCaptureToast] = useState<{ photoIds: string[]; phase: Phase | null } | null>(null)
  const [actionSheetPhoto, setActionSheetPhoto] = useState<Photo | null>(null)
  const [overlayBasePhoto, setOverlayBasePhoto] = useState<Photo | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const project = getProject(projectId ?? '')

  useEffect(() => {
    localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    localStorage.setItem(GRID_SIZE_KEY, gridSize)
  }, [gridSize])

  useEffect(() => {
    localStorage.setItem(PHASE_VISIBILITY_KEY, JSON.stringify([...visiblePhases]))
  }, [visiblePhases])

  if (!project) return <Navigate to="/" replace />

  const displayPhotos = photos.filter((p) => visiblePhases.has(p.phase ?? 'unclassified'))

  // フェーズ表示フィルタの個別ON/OFF。最後の1つはOFFにできない（無視する）
  const togglePhaseVisibility = (key: PhaseKey) => {
    setVisiblePhases((prev) => {
      if (prev.has(key) && prev.size === 1) return prev
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    clear()
  }

  const handleShowAllPhases = () => {
    setVisiblePhases(new Set(ALL_PHASE_KEYS))
    clear()
  }

  const handleBatchPhaseChange = (phase: Phase | null) => {
    selected.forEach((id) => setPhase(id, phase))
    clear()
  }

  // カメラ起動FABで撮影 → 表示フィルタには依存せず未分類で保存（トーストから変更可能）
  const handleCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (files.length === 0) return

    const phase: Phase | null = null

    setCapturing(true)
    try {
      const uploaded = await uploadPhotos(files, phase, () => {})
      setCaptureToast({ photoIds: uploaded.map((p) => p.id), phase })
    } finally {
      setCapturing(false)
    }
  }

  const handleCaptureToastPhaseChange = (newPhase: Phase | null) => {
    captureToast?.photoIds.forEach((id) => setPhase(id, newPhase))
  }

  // 写真の長押し → アクションシートを開く
  const handlePhotoLongPress = (photo: Photo) => {
    setActionSheetPhoto(photo)
  }

  // PC: Shift+クリックで直前の選択からの範囲選択（表示中の並び順に基づく）
  const handleRangeSelect = (id: string) => {
    selectRange(displayPhotos, id)
  }

  const handleOpenOverlayCapture = () => {
    setOverlayBasePhoto(null)
    setShowOverlayCapture(true)
  }

  const handleCloseOverlayCapture = () => {
    setShowOverlayCapture(false)
    setOverlayBasePhoto(null)
  }

  const handleActionSheetSetPhase = (phase: Phase | null) => {
    if (!actionSheetPhoto) return
    setPhase(actionSheetPhoto.id, phase)
    setActionSheetPhoto(null)
  }

  const handleUseAsOverlayBase = () => {
    if (!actionSheetPhoto) return
    setOverlayBasePhoto(actionSheetPhoto)
    setShowOverlayCapture(true)
    setActionSheetPhoto(null)
  }

  const handleStartSelectionFromActionSheet = () => {
    if (!actionSheetPhoto) return
    toggle(actionSheetPhoto.id)
    setActionSheetPhoto(null)
  }

  const handleActionSheetDelete = async () => {
    if (!actionSheetPhoto) return
    await removePhoto(actionSheetPhoto.id)
    setActionSheetPhoto(null)
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
            {/* PC: 写真を重ねて撮影（写真が1枚以上ある場合のみ） */}
            {photos.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="hidden lg:flex gap-1.5"
                onClick={handleOpenOverlayCapture}
              >
                <Layers className="h-4 w-4" />
                写真を重ねて撮影
              </Button>
            )}
            {/* Excel出力ボタン（写真が1枚以上ある場合のみ表示） */}
            {photos.length > 0 && (
              <ExportButton project={project} photos={photos} />
            )}
            {/* 大写真（1列3段）テンプレート（写真が1枚以上ある場合のみ表示） */}
            {photos.length > 0 && (
              <LargePhotoExportButton project={project} photos={photos} />
            )}
            {/* 施工前後テンプレート（before / after が各1枚以上ある場合のみ表示） */}
            {hasBeforeAfter && (
              <BeforeAfterExportButton project={project} photos={photos} />
            )}
            {/* ZIP出力（Excel台帳 + 圧縮写真一式、写真が1枚以上ある場合のみ表示） */}
            {photos.length > 0 && (
              <ZipExportButton project={project} photos={photos} />
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

      {/* フェーズ表示フィルタ + 表示サイズ切替 + ビュー切り替え */}
      <div className="border-b bg-background sticky top-14 z-30">
        <div className="flex items-center">
          {/* フェーズ表示フィルタ（複数選択トグル） */}
          <div className="flex overflow-x-auto flex-1 gap-1.5 px-2 py-2">
            {PHASE_VISIBILITY_ITEMS.map(({ key, label, activeClass }) => {
              const count = key === 'unclassified' ? unclassifiedCount : phaseCount(key)
              const active = visiblePhases.has(key)
              return (
                <button
                  key={key}
                  onClick={() => togglePhaseVisibility(key)}
                  aria-pressed={active}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full border transition-colors shrink-0 whitespace-nowrap',
                    active ? activeClass : 'border-transparent text-muted-foreground opacity-50 hover:opacity-80',
                  )}
                >
                  <span>{label}</span>
                  <span className="text-xs">（{count}）</span>
                </button>
              )
            })}
          </div>

          {/* 表示サイズ切替（PC・グリッド表示のみ） */}
          {viewMode === 'grid' && (
            <div className="hidden lg:flex items-center gap-0.5 px-2 shrink-0 border-l">
              {GRID_SIZES.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setGridSize(value)}
                  className={cn(
                    'px-2 py-1.5 rounded text-xs font-medium transition-colors',
                    gridSize === value
                      ? 'text-foreground bg-muted'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  aria-label={`表示サイズ: ${label}`}
                  aria-pressed={gridSize === value}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

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
        <FilterEmptyState onShowAll={handleShowAllPhases} />
      ) : viewMode === 'ledger' ? (
        <LedgerView
          photos={displayPhotos}
          onPhotoClick={setLightboxPhoto}
          onCommentChange={setComment}
          onFloorLocationChange={setFloorLocation}
          onMovePhoto={handleMovePhoto}
        />
      ) : (
        <PhotoGrid
          photos={displayPhotos}
          onPhotoClick={setLightboxPhoto}
          onPhotoLongPress={handlePhotoLongPress}
          selectedIds={selected}
          onToggle={toggle}
          onRangeSelect={handleRangeSelect}
          gridSize={gridSize}
        />
      )}

      {/* スマホ用 FAB: 写真を重ねて撮影（写真が1枚以上ある場合のみ） */}
      {photos.length > 0 && (
        <button
          onClick={handleOpenOverlayCapture}
          className="lg:hidden fixed bottom-[216px] right-4 z-50 h-14 w-14 rounded-full bg-secondary text-secondary-foreground shadow-lg flex items-center justify-center hover:bg-secondary/80 active:scale-95 transition-all"
          aria-label="写真を重ねて撮影"
        >
          <Layers className="h-6 w-6" />
        </button>
      )}

      {/* スマホ用 FAB: ギャラリーから追加 */}
      <button
        onClick={() => setShowUpload(true)}
        className="lg:hidden fixed bottom-[148px] right-4 z-50 h-14 w-14 rounded-full bg-secondary text-secondary-foreground shadow-lg flex items-center justify-center hover:bg-secondary/80 active:scale-95 transition-all"
        aria-label="ギャラリーから追加"
      >
        <ImagePlus className="h-6 w-6" />
      </button>

      {/* スマホ用 FAB: カメラで撮影（端末カメラを直接起動） */}
      <button
        onClick={() => cameraInputRef.current?.click()}
        disabled={capturing}
        className="lg:hidden fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-60"
        aria-label="カメラで撮影"
      >
        {capturing ? (
          <span className="h-6 w-6 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        ) : (
          <Camera className="h-6 w-6" />
        )}
      </button>

      {/* カメラ直接起動用（非表示input） */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleCameraCapture}
      />

      {/* 撮影直後の保存先確認トースト */}
      {captureToast && (
        <PhaseSaveToast
          phase={captureToast.phase}
          onChangePhase={handleCaptureToastPhaseChange}
          onDismiss={() => setCaptureToast(null)}
        />
      )}

      {/* アップロードモーダル: 表示フィルタとは独立して未分類を初期値とし、モーダル内で選択可能 */}
      <PhotoUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={projectId ?? ''}
        defaultPhase={null}
      />

      {/* 写真を重ねて撮影モーダル */}
      <OverlayCaptureModal
        open={showOverlayCapture}
        onClose={handleCloseOverlayCapture}
        projectId={projectId ?? ''}
        photos={photos}
        initialPhoto={overlayBasePhoto}
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

      {/* 写真長押しアクションシート */}
      {actionSheetPhoto && (
        <PhotoActionSheet
          photo={actionSheetPhoto}
          onClose={() => setActionSheetPhoto(null)}
          onSetPhase={handleActionSheetSetPhase}
          onUseAsOverlayBase={handleUseAsOverlayBase}
          onStartSelection={handleStartSelectionFromActionSheet}
          onDelete={handleActionSheetDelete}
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

function FilterEmptyState({ onShowAll }: { onShowAll: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-3 text-center p-4">
      <p className="text-muted-foreground text-sm">
        表示中のフィルターに一致する写真はありません
      </p>
      <Button variant="outline" size="sm" onClick={onShowAll}>
        すべて表示
      </Button>
    </div>
  )
}
