import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, Navigate } from 'react-router-dom'
import { ChevronLeft, Camera, ImagePlus, Layers, Pencil, Plus, LayoutGrid, List, Columns2, Folder, FolderPlus, FolderPen, Trash2, CheckSquare } from 'lucide-react'
import { ExportButton } from '@/components/project/ExportButton'
import { BeforeAfterExportButton } from '@/components/project/BeforeAfterExportButton'
import { LargePhotoExportButton } from '@/components/project/LargePhotoExportButton'
import { ZipExportButton } from '@/components/project/ZipExportButton'
import { useProjects } from '@/hooks/useProjects'
import { usePhotos } from '@/hooks/usePhotos'
import { usePhotoFolders } from '@/hooks/usePhotoFolders'
import { usePhotoSelection } from '@/hooks/usePhotoSelection'
import { Header } from '@/components/layout/Header'
import { PhotoGrid, type GridSize } from '@/components/photo/PhotoGrid'
import { LedgerView } from '@/components/photo/LedgerView'
import { CompareView } from '@/components/photo/CompareView'
import { BatchActionBar } from '@/components/photo/BatchActionBar'
import { PhotoUploadModal } from '@/components/photo/PhotoUploadModal'
import { OverlayCaptureModal } from '@/components/photo/OverlayCaptureModal'
import { PhotoLightbox } from '@/components/photo/PhotoLightbox'
import { PhaseSaveToast } from '@/components/photo/PhaseSaveToast'
import { PhotoActionSheet } from '@/components/photo/PhotoActionSheet'
import { DeviceSaveBanner } from '@/components/photo/DeviceSaveBanner'
import { FolderList } from '@/components/photo/FolderList'
import { SubfolderRow } from '@/components/photo/SubfolderRow'
import { FolderFormModal } from '@/components/photo/FolderFormModal'
import { FolderPickerSheet } from '@/components/photo/FolderPickerSheet'
import { FolderDeleteConfirmModal } from '@/components/photo/FolderDeleteConfirmModal'
import { useDeviceSave } from '@/hooks/useDeviceSave'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { ALL_PHASE_KEYS, PHASE_KEY_ACTIVE_CLASS, PHASE_KEY_LABEL, type Phase, type PhaseKey } from '@/types/photo'
import type { Photo, PhotoFolder } from '@/types/photo'

type ViewMode = 'grid' | 'ledger' | 'compare'

const PHASE_VISIBILITY_ITEMS: { key: PhaseKey; label: string; activeClass: string }[] = ALL_PHASE_KEYS.map((key) => ({
  key,
  label: PHASE_KEY_LABEL[key],
  activeClass: PHASE_KEY_ACTIVE_CLASS[key],
}))

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
  const { photos, removePhoto, removePhotos, setComment, setFloorLocation, setPhase, setPhaseForPhotos, moveToFolder, reorderPhotos, uploadPhotos } = usePhotos(projectId ?? '')
  const { folders, photoCountByFolder, folderPathLabel, getFolderDeletionInfo, createFolder, renameFolder, removeFolder } = usePhotoFolders(projectId ?? '', removePhotos)
  const { selected, toggle, selectRange, selectAll, clear } = usePhotoSelection()
  const deviceSave = useDeviceSave()

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

  // フォルダ閲覧状態（未分類のみ表示している時だけ有効）。
  // undefined = フォルダ一覧（トップ）を表示 / null = 「フォルダなし」の中身
  // string[]（1件以上） = 開いているフォルダの経路（末尾が現在地。階層ナビ・パンくず用）
  const [folderView, setFolderView] = useState<string[] | null | undefined>(undefined)
  const [showCreateFolder, setShowCreateFolder] = useState(false)
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [deletingFolderId, setDeletingFolderId] = useState<string | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [creatingFolderForMove, setCreatingFolderForMove] = useState(false)

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

  // フォルダ一覧は「未分類のみを表示中」かつ「比較モードではない」時だけ使う
  // （施工前/中/後にはフォルダ概念を持ち込まない。比較モードは各ペイン独自のタブ切替のため対象外）
  const isUnclassifiedOnly = visiblePhases.size === 1 && visiblePhases.has('unclassified')
  const showFolderBrowsing = isUnclassifiedOnly && viewMode !== 'compare'
  const showFolderList = showFolderBrowsing && folderView === undefined

  // 現在開いているフォルダのID（フォルダなし表示中はnull、フォルダ一覧表示中はundefined）
  const currentFolderId = Array.isArray(folderView) ? folderView[folderView.length - 1] : folderView

  // 現在の経路上の実フォルダオブジェクト列（パンくず表示用。先頭が最上位、末尾が現在地）
  const folderPathChain: PhotoFolder[] = Array.isArray(folderView)
    ? folderView.map((id) => folders.find((f) => f.id === id)).filter((f): f is PhotoFolder => !!f)
    : []

  // フォルダの中身を開いている間は、displayPhotosをさらにfolder_idで絞り込む（直下の写真のみ。
  // サブフォルダの中の写真は含まない＝Windows Explorer同様、フォルダとファイルを別々に扱う）
  const folderScopedPhotos =
    showFolderBrowsing && folderView !== undefined
      ? displayPhotos.filter((p) => (p.folder_id ?? null) === currentFolderId)
      : displayPhotos

  // 現在開いているフォルダ直下のサブフォルダ一覧（トップレベルのフォルダ一覧画面では使わない）
  const currentSubfolders = showFolderBrowsing && Array.isArray(folderView)
    ? folders.filter((f) => (f.parent_folder_id ?? null) === currentFolderId)
    : []

  const topLevelFolders = folders.filter((f) => (f.parent_folder_id ?? null) === null)

  // 「写真を追加」モーダルの取り込み先初期値：実際にフォルダの中身を開いている時だけ
  // そのフォルダを渡す（フォルダ一覧画面・「フォルダなし」表示中・比較モード等では
  // 未分類直下＝nullを渡す）
  const uploadInitialFolderId = showFolderBrowsing && Array.isArray(folderView) ? currentFolderId ?? null : null

  const currentFolderLabel =
    folderView === null ? 'フォルダなし（未分類直下）' : folderPathChain.map((f) => f.name).join(' / ')

  // パンくず表示用のセグメント列（先頭は常に「未分類」＝トップレベルへのリンク）
  const breadcrumbSegments: { label: string; onClick?: () => void }[] = (() => {
    const segments: { label: string; onClick?: () => void }[] = [
      { label: '未分類', onClick: () => { setFolderView(undefined); clear() } },
    ]
    if (folderView === null) {
      segments.push({ label: 'フォルダなし' })
    } else if (Array.isArray(folderView)) {
      folderPathChain.forEach((folder, i) => {
        const isCurrent = i === folderPathChain.length - 1
        segments.push({
          label: folder.name,
          onClick: isCurrent
            ? undefined
            : () => { setFolderView(folderPathChain.slice(0, i + 1).map((f) => f.id)); clear() },
        })
      })
    }
    return segments
  })()

  // フェーズ表示フィルタの個別ON/OFF。最後の1つはOFFにできない（無視する）
  const togglePhaseVisibility = (key: PhaseKey) => {
    setVisiblePhases((prev) => {
      if (prev.has(key) && prev.size === 1) return prev
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
    setFolderView(undefined)
    clear()
  }

  const handleShowAllPhases = () => {
    setVisiblePhases(new Set(ALL_PHASE_KEYS))
    setFolderView(undefined)
    clear()
  }

  // ─── フォルダ操作 ──────────────────────────────────────────
  // トップレベルのフォルダ一覧から開けば親なし、フォルダの中から「サブフォルダ」で
  // 開けば現在のフォルダを親として作成する
  const handleCreateFolder = async (name: string) => {
    const parentId = Array.isArray(folderView) ? currentFolderId ?? null : null
    await createFolder(name, parentId)
    setShowCreateFolder(false)
  }

  const handleRenameFolder = async (name: string) => {
    if (!renamingFolderId) return
    await renameFolder(renamingFolderId, name)
    setRenamingFolderId(null)
  }

  // フォルダ削除は確認ダイアログ（FolderDeleteConfirmModal）で
  // 「フォルダだけ削除」「フォルダと写真を削除」の2択を選ばせる
  const handleDeleteFolder = () => {
    if (!currentFolderId) return
    setDeletingFolderId(currentFolderId)
  }

  const handleAfterFolderDeleted = () => {
    setDeletingFolderId(null)
    // 削除したフォルダより1つ上の階層へ戻る（トップレベルフォルダの削除ならフォルダ一覧へ）
    if (Array.isArray(folderView) && folderView.length > 1) {
      setFolderView(folderView.slice(0, -1))
    } else {
      setFolderView(undefined)
    }
  }

  const handleConfirmDeleteFolderKeepPhotos = async () => {
    if (!deletingFolderId) return
    await removeFolder(deletingFolderId, 'keepPhotos')
    handleAfterFolderDeleted()
  }

  const handleConfirmDeleteFolderWithPhotos = async () => {
    if (!deletingFolderId) return
    await removeFolder(deletingFolderId, 'deletePhotos')
    handleAfterFolderDeleted()
  }

  // フォルダ一覧・サブフォルダタイルからフォルダを開く
  const handleOpenFolder = (folderId: string | null) => {
    setFolderView(folderId === null ? null : [folderId])
    clear()
  }

  const handleOpenSubfolder = (folderId: string) => {
    setFolderView((prev) => (Array.isArray(prev) ? [...prev, folderId] : [folderId]))
    clear()
  }

  // パンくずの「戻る」= 1階層だけ上へ戻る
  const handleBackOneLevel = () => {
    if (Array.isArray(folderView) && folderView.length > 1) {
      setFolderView(folderView.slice(0, -1))
    } else {
      setFolderView(undefined)
    }
    clear()
  }

  // 複数選択中の写真をフォルダへ移動
  const handleMoveSelectedToFolder = (folderId: string | null) => {
    moveToFolder(Array.from(selected), folderId)
    setShowFolderPicker(false)
    setCreatingFolderForMove(false)
    clear()
  }

  const handleCreateFolderForMove = async (name: string) => {
    const folder = await createFolder(name)
    handleMoveSelectedToFolder(folder.id)
  }

  // 選択順（タップした順）ではなく、変更前の画面上の並び順を維持したままフェーズ変更する
  const handleBatchPhaseChange = (phase: Phase | null) => {
    const orderedIds = folderScopedPhotos.filter((p) => selected.has(p.id)).map((p) => p.id)
    setPhaseForPhotos(orderedIds, phase)
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
      // 撮影後にスマホ保存バナーを表示（<input capture> で OS 保存済みの場合も含め任意で再保存可能）
      deviceSave.queueFiles(files)
    } finally {
      setCapturing(false)
    }
  }

  const handleCaptureToastPhaseChange = (newPhase: Phase | null) => {
    if (!captureToast) return
    setPhaseForPhotos(captureToast.photoIds, newPhase)
  }

  // 写真の長押し → アクションシートを開く
  const handlePhotoLongPress = (photo: Photo) => {
    setActionSheetPhoto(photo)
  }

  // PC: Shift+クリックで直前の選択からの範囲選択（画面に実際に表示中の並び順に基づく。
  // フォルダ中身を表示中はfolderScopedPhotosがdisplayPhotosの絞り込みなのでそちらを使う）
  const handleRangeSelect = (id: string) => {
    selectRange(folderScopedPhotos, id)
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
    console.time('[perf] removePhoto total')
    await removePhoto(actionSheetPhoto.id)
    console.timeEnd('[perf] removePhoto total')
    setActionSheetPhoto(null)
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
          {/* フェーズ表示フィルタ（複数選択トグル、比較モードでは各ペインのタブに置き換わるため非表示） */}
          {viewMode === 'compare' ? (
            <div className="flex-1" />
          ) : (
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
          )}

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
            <button
              onClick={() => setViewMode('compare')}
              className={cn(
                'p-1.5 rounded transition-colors',
                viewMode === 'compare'
                  ? 'text-foreground bg-muted'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              aria-label="比較・並び替え表示"
              aria-pressed={viewMode === 'compare'}
            >
              <Columns2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* コンテンツ */}
      {photos.length === 0 ? (
        <PhotoEmptyState onUpload={() => setShowUpload(true)} />
      ) : viewMode === 'compare' ? (
        <CompareView
          photos={photos}
          onCommentChange={setComment}
          onFloorLocationChange={setFloorLocation}
          onReorder={reorderPhotos}
          onDeletePhoto={removePhoto}
        />
      ) : showFolderList ? (
        <FolderList
          folders={topLevelFolders}
          photoCountByFolder={photoCountByFolder}
          noFolderCount={displayPhotos.filter((p) => (p.folder_id ?? null) === null).length}
          onOpenFolder={handleOpenFolder}
          onCreateFolder={() => setShowCreateFolder(true)}
        />
      ) : displayPhotos.length === 0 && !(showFolderBrowsing && folderView !== undefined) ? (
        // フォルダ中身を閲覧中（folderView !== undefined）は、プロジェクト全体の未分類写真が
        // たまたま0枚でも「このフィルターに一致する写真がありません」を出さない。
        // フォルダ自体の操作（パンくず・サブフォルダ作成等）は下のフォルダ操作バーで
        // 常に提供するため、ここでは「表示フィルタそのものが空」の場合だけを対象にする。
        <FilterEmptyState onShowAll={handleShowAllPhases} />
      ) : (
        <>
          {/* フォルダ操作バー（パンくず・サブフォルダ作成・名前変更・削除・すべて選択）は
              フォルダ中身を表示している間は、中身が空かどうかに関わらず常に表示する
              （写真0枚 ≠ フォルダ自体が存在しない。空フォルダでもサブフォルダ作成等の
              操作は必要なため、下のコンテンツ切り替えとは独立してここで描画する） */}
          {showFolderBrowsing && folderView !== undefined && (
            <FolderBreadcrumb
              segments={breadcrumbSegments}
              isRealFolder={Array.isArray(folderView)}
              onBack={handleBackOneLevel}
              onCreateSubfolder={() => setShowCreateFolder(true)}
              onRename={() => setRenamingFolderId(currentFolderId ?? null)}
              onDelete={handleDeleteFolder}
              onSelectAll={() => selectAll(folderScopedPhotos.map((p) => p.id))}
            />
          )}

          {/* コンテンツ本体：サブフォルダ・写真の有無に応じて切り替える（フォルダ操作バーには影響しない） */}
          {showFolderBrowsing && folderView !== undefined
            && folderScopedPhotos.length === 0 && currentSubfolders.length === 0 ? (
            <FolderEmptyState folderLabel={currentFolderLabel} />
          ) : (
            <>
              {/* サブフォルダタイル（直下の写真と同じ画面にまとめて表示。無ければ何も描画しない） */}
              <SubfolderRow
                folders={currentSubfolders}
                photoCountByFolder={photoCountByFolder}
                onOpenFolder={handleOpenSubfolder}
              />
              {folderScopedPhotos.length > 0 && (
                viewMode === 'ledger' ? (
                  <LedgerView
                    photos={folderScopedPhotos}
                    onPhotoClick={setLightboxPhoto}
                    onCommentChange={setComment}
                    onFloorLocationChange={setFloorLocation}
                    onReorder={reorderPhotos}
                  />
                ) : (
                  <PhotoGrid
                    photos={folderScopedPhotos}
                    onPhotoClick={setLightboxPhoto}
                    onPhotoLongPress={handlePhotoLongPress}
                    selectedIds={selected}
                    onToggle={toggle}
                    onRangeSelect={handleRangeSelect}
                    gridSize={gridSize}
                    onReorder={reorderPhotos}
                  />
                )
              )}
            </>
          )}
        </>
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

      {/* アップロードモーダル: 表示フィルタとは独立して未分類を初期値とし、モーダル内で選択可能。
          取り込み先フォルダは開いていたフォルダを初期値にする（モーダル内で変更可能） */}
      <PhotoUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        projectId={projectId ?? ''}
        defaultPhase={null}
        initialFolderId={uploadInitialFolderId}
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
          photos={folderScopedPhotos}
          onClose={() => setLightboxPhoto(null)}
          onChange={setLightboxPhoto}
          onDelete={async (photoId) => {
            await removePhoto(photoId)
          }}
        />
      )}

      {/* 一括フェーズ変更バー（未分類のみ表示中はフォルダへ移動ボタンも表示） */}
      <BatchActionBar
        count={selected.size}
        onPhaseChange={handleBatchPhaseChange}
        onClear={clear}
        onMoveToFolder={isUnclassifiedOnly ? () => setShowFolderPicker(true) : undefined}
      />

      {/* スマホに保存バナー（カメラFABより上、BottomNavより上に配置） */}
      <DeviceSaveBanner
        saveMode={deviceSave.saveMode}
        dirHandle={deviceSave.dirHandle}
        pendingFiles={deviceSave.pendingFiles}
        savePhase={deviceSave.savePhase}
        onSaveToDir={deviceSave.handleSaveToDir}
        onPickFolderAndSave={deviceSave.handlePickFolderAndSave}
        onChangeFolder={deviceSave.handleChangeFolder}
        onFallbackSave={deviceSave.handleFallbackSave}
        onDismiss={deviceSave.dismiss}
        positionClass="bottom-24"
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

      {/* フォルダ新規作成 */}
      <FolderFormModal
        open={showCreateFolder}
        title="新規フォルダ"
        submitLabel="作成"
        onClose={() => setShowCreateFolder(false)}
        onSubmit={handleCreateFolder}
      />

      {/* フォルダ名変更 */}
      <FolderFormModal
        open={renamingFolderId !== null}
        title="フォルダ名を変更"
        submitLabel="保存"
        initialName={folders.find((f) => f.id === renamingFolderId)?.name ?? ''}
        onClose={() => setRenamingFolderId(null)}
        onSubmit={handleRenameFolder}
      />

      {/* フォルダ削除確認（フォルダだけ削除 / フォルダと写真を削除の2択） */}
      <FolderDeleteConfirmModal
        open={deletingFolderId !== null}
        folderName={folders.find((f) => f.id === deletingFolderId)?.name ?? ''}
        descendantFolderCount={deletingFolderId ? getFolderDeletionInfo(deletingFolderId).descendantFolderCount : 0}
        photoCount={deletingFolderId ? getFolderDeletionInfo(deletingFolderId).photoCount : 0}
        onCancel={() => setDeletingFolderId(null)}
        onKeepPhotos={handleConfirmDeleteFolderKeepPhotos}
        onDeletePhotos={handleConfirmDeleteFolderWithPhotos}
      />

      {/* 複数選択写真の移動先フォルダ選択（階層に関わらずプロジェクト内の全フォルダをフラットに提示） */}
      <FolderPickerSheet
        open={showFolderPicker}
        folders={folders}
        folderLabel={folderPathLabel}
        onClose={() => setShowFolderPicker(false)}
        onSelect={handleMoveSelectedToFolder}
        onCreateNew={() => {
          setShowFolderPicker(false)
          setCreatingFolderForMove(true)
        }}
      />
      <FolderFormModal
        open={creatingFolderForMove}
        title="新規フォルダを作成して移動"
        submitLabel="作成して移動"
        onClose={() => setCreatingFolderForMove(false)}
        onSubmit={handleCreateFolderForMove}
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

// フォルダの中身が空（写真もサブフォルダも無い）ことだけを示す表示。
// 戻る・サブフォルダ作成等の操作は常時表示のフォルダ操作バー（FolderBreadcrumb）側に
// あるため、ここには含めない（「戻る」ボタンの重複を避けるため）。
function FolderEmptyState({ folderLabel }: { folderLabel: string }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[30vh] gap-1 text-center p-4">
      <p className="text-sm font-medium">「{folderLabel}」は空です</p>
      <p className="text-xs text-muted-foreground">
        上の「サブフォルダ」から整理を始めるか、写真をこのフォルダへ移動してください
      </p>
    </div>
  )
}

/**
 * フォルダ中身表示中のパンくず（例: 未分類 > 6階 > 外部）+ 操作
 * （1階層戻る・サブフォルダ作成・すべて選択・名前変更・削除）。
 * segmentsは先頭が常に「未分類」（トップレベルへのリンク）、以降が開いている経路。
 * 最後のセグメント（現在地）だけはonClickを持たない。
 */
function FolderBreadcrumb({
  segments,
  isRealFolder,
  onBack,
  onCreateSubfolder,
  onRename,
  onDelete,
  onSelectAll,
}: {
  segments: { label: string; onClick?: () => void }[]
  isRealFolder: boolean
  onBack: () => void
  onCreateSubfolder: () => void
  onRename: () => void
  onDelete: () => void
  onSelectAll: () => void
}) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 border-b bg-muted/30 text-sm overflow-x-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-muted-foreground hover:text-foreground shrink-0"
      >
        <ChevronLeft className="h-4 w-4" />
        戻る
      </button>
      <span className="text-muted-foreground shrink-0">|</span>

      {/* パンくず本体 */}
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-x-auto">
        {segments.map((seg, i) => (
          <span key={i} className="flex items-center gap-1 shrink-0">
            {i > 0 && <span className="text-muted-foreground text-xs">›</span>}
            {seg.onClick ? (
              <button
                onClick={seg.onClick}
                className="text-muted-foreground hover:text-foreground truncate max-w-[7rem]"
              >
                {seg.label}
              </button>
            ) : (
              <span className="font-medium truncate max-w-[7rem] flex items-center gap-1">
                {i > 0 && <Folder className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                {seg.label}
              </span>
            )}
          </span>
        ))}
      </div>

      <button
        onClick={onSelectAll}
        className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
      >
        <CheckSquare className="h-3.5 w-3.5" />
        すべて選択
      </button>
      {isRealFolder && (
        <>
          <button
            onClick={onCreateSubfolder}
            className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
          >
            <FolderPlus className="h-3.5 w-3.5" />
            サブフォルダ
          </button>
          <button
            onClick={onRename}
            className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted transition-colors"
          >
            <FolderPen className="h-3.5 w-3.5" />
            名前変更
          </button>
          <button
            onClick={onDelete}
            className="shrink-0 flex items-center gap-1 text-xs text-destructive hover:bg-destructive/5 px-2 py-1 rounded transition-colors"
          >
            <Trash2 className="h-3.5 w-3.5" />
            削除
          </button>
        </>
      )}
    </div>
  )
}
