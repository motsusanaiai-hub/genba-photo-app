import { useEffect, useRef, useState } from 'react'
import { X, ImagePlus, Upload, TriangleAlert, Folder as FolderIcon } from 'lucide-react'
import { usePhotos } from '@/hooks/usePhotos'
import { usePhotoFolders } from '@/hooks/usePhotoFolders'
import { Button } from '@/components/ui/button'
import { FolderPickerSheet } from '@/components/photo/FolderPickerSheet'
import { FolderFormModal } from '@/components/photo/FolderFormModal'
import { cn } from '@/lib/utils'
import { supportsDirectoryDrop, getTopLevelEntries, readEntryRecursively, type DroppedFile } from '@/utils/droppedFolder'
import type { Phase, PhotoFolder } from '@/types/photo'

const PHASE_OPTIONS: { value: Phase; label: string }[] = [
  { value: 'before', label: '施工前' },
  { value: 'during', label: '施工中' },
  { value: 'after',  label: '施工後' },
]

interface Props {
  open: boolean
  onClose: () => void
  projectId: string
  defaultPhase: Phase | null
  // モーダルを開いた時点で未分類タブ内で開いていたフォルダのID（未分類直下ならnull）。
  // 「取り込み先」の初期値として使う。フェーズ指定取り込みには影響しない。
  initialFolderId?: string | null
}

interface SelectedFile {
  file: File
  preview: string
  phase: Phase | null
  // Windowsフォルダごとドラッグ＆ドロップした場合の階層パス（例: ["6階","外部"]）。
  // phase===nullの時のみ、未分類フォルダ階層として反映される。単体ファイルは空配列。
  folderPath: string[]
}

export function PhotoUploadModal({ open, onClose, projectId, defaultPhase, initialFolderId = null }: Props) {
  const { uploadPhotosWithPhases } = usePhotos(projectId)
  const { folders, folderPathLabel, createFolder } = usePhotoFolders(projectId)
  const inputRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  // 未分類（phase===null）として追加する写真の取り込み先フォルダ。nullは未分類直下。
  // Windowsフォルダごとドロップした写真はこれより優先してfolderPathから解決される。
  const [destinationFolderId, setDestinationFolderId] = useState<string | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [creatingFolderForUpload, setCreatingFolderForUpload] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [warningFilenames, setWarningFilenames] = useState<string[] | null>(null)

  // モーダルを開いた瞬間のページ側フェーズタブ・開いていたフォルダを初期選択に反映する。
  // 開いた後にページ側の状態が変わってもこの選択には追従させない。
  useEffect(() => {
    if (open) {
      setPhase(defaultPhase)
      setDestinationFolderId(initialFolderId)
      setWarningFilenames(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  // 画像判定 + SelectedFileへの変換。通常のファイル選択・フォルダドロップ両方から使う共通処理。
  const addFiles = (items: DroppedFile[]) => {
    const images = items.filter(
      ({ file }) => file.type.startsWith('image/') || file.name.match(/\.(heic|heif)$/i),
    )
    if (images.length === 0) return
    const additions: SelectedFile[] = images.map(({ file, folderPath }) => ({
      file,
      preview: URL.createObjectURL(file),
      phase,
      folderPath,
    }))
    setSelected((prev) => [...prev, ...additions])
  }

  // 追加済みの選択は上書きせず、現在選択中のフェーズを各ファイルに記録して追加する
  const handleFiles = (incoming: File[]) => {
    addFiles(incoming.map((file) => ({ file, folderPath: [] })))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)

  // フォルダごとドロップされた場合はDrag and Drop Entries API（webkitGetAsEntry）で
  // 再帰的に中のファイルを読み取り、階層パス（例: ["6階","外部"]）をfolderPathとして記録する。
  // 非対応ブラウザ・単体ファイルのみのドロップでは従来どおりdataTransfer.filesを使う。
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)

    const items = e.dataTransfer.items
    if (!supportsDirectoryDrop(items)) {
      handleFiles(Array.from(e.dataTransfer.files))
      return
    }

    // DataTransferはイベントハンドラを抜けると無効化されるため、
    // entryの取得（webkitGetAsEntry）はawaitを挟まずここで同期的に行う
    const entries = getTopLevelEntries(items)
    if (entries.length === 0) {
      handleFiles(Array.from(e.dataTransfer.files))
      return
    }

    const results = await Promise.all(entries.map((entry) => readEntryRecursively(entry, [])))
    addFiles(results.flat())
  }

  // フォルダ階層パス（例: ["6階","外部"]）→ 最下層フォルダIDを解決する。
  // 各階層で「同じ親フォルダの中に同名フォルダが既にあれば再利用、無ければ新規作成」を
  // 繰り返す（＝別の親フォルダ配下の同名フォルダとは区別される）。中間階層（例: "6階"）も
  // 同じキャッシュに乗るため、複数のサブフォルダ（"6階/外部" と "6階/トイレ" 等）で
  // 親フォルダを二重作成することはない。
  const resolveFolderId = async (
    path: string[],
    cache: Map<string, string>,
  ): Promise<string | null> => {
    let parentId: string | null = null
    let currentPath: string[] = []
    for (const segment of path) {
      currentPath = [...currentPath, segment]
      const key = currentPath.join('/')
      const cached = cache.get(key)
      if (cached) {
        parentId = cached
        continue
      }
      const existing: PhotoFolder | undefined = folders.find(
        (f) => f.name === segment && (f.parent_folder_id ?? null) === parentId,
      )
      const folder: PhotoFolder = existing ?? (await createFolder(segment, parentId))
      cache.set(key, folder.id)
      parentId = folder.id
    }
    return parentId
  }

  const handleUpload = async () => {
    if (selected.length === 0) return
    setUploading(true)
    setProgress({ done: 0, total: selected.length })

    // フォルダパス → フォルダID の解決（Windowsフォルダごとドロップした分のみ対象）。
    // 同じパスが複数ファイルに登場しても1回しか解決（作成）しないようキャッシュする。
    const folderIdByPath = new Map<string, string>()
    const uniquePaths = [
      ...new Set(
        selected
          .filter((s) => s.phase === null && s.folderPath.length > 0)
          .map((s) => s.folderPath.join('/')),
      ),
    ]
    for (const key of uniquePaths) {
      await resolveFolderId(key.split('/'), folderIdByPath)
    }

    // 未分類として追加する写真のフォルダ決定順位：
    //   1. Windowsフォルダごとドロップした写真（folderPathあり）→ その階層構造を優先
    //   2. それ以外（通常のファイル選択・カメラロール・単体ドロップ）
    //      → モーダルで選んだ「取り込み先」（destinationFolderId）
    // フェーズ指定（施工前/中/後）の写真はフォルダを一切持たない（従来どおり）。
    const uploaded = await uploadPhotosWithPhases(
      selected.map(({ file, phase, folderPath }) => {
        if (phase !== null) return { file, phase, folderId: null }
        const folderId =
          folderPath.length > 0
            ? folderIdByPath.get(folderPath.join('/')) ?? null
            : destinationFolderId
        return { file, phase, folderId }
      }),
      (done, total) => setProgress({ done, total }),
    )
    const failedNames = uploaded.filter((p) => p.format_warning).map((p) => p.original_filename)
    cleanup()
    if (failedNames.length > 0) {
      setWarningFilenames(failedNames)
    } else {
      onClose()
    }
  }

  const cleanup = () => {
    selected.forEach(({ preview }) => URL.revokeObjectURL(preview))
    setSelected([])
    setUploading(false)
    setProgress({ done: 0, total: 0 })
  }

  const handleClose = () => {
    if (uploading) return
    cleanup()
    setWarningFilenames(null)
    onClose()
  }

  const handleCreateFolderForUpload = async (name: string) => {
    const folder = await createFolder(name)
    setDestinationFolderId(folder.id)
    setCreatingFolderForUpload(false)
  }

  const destinationFolder = destinationFolderId ? folders.find((f) => f.id === destinationFolderId) ?? null : null
  const destinationLabel = destinationFolder ? folderPathLabel(destinationFolder) : '未分類直下'

  const countByPhase = (p: Phase | null) => selected.filter((s) => s.phase === p).length
  const folderPaths = [
    ...new Set(
      selected
        .filter((s) => s.phase === null && s.folderPath.length > 0)
        .map((s) => s.folderPath.join(' / ')),
    ),
  ]

  return (
    <div className="fixed inset-0 z-[60] flex items-end lg:items-center justify-center">
      {/* オーバーレイ */}
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />

      {/* モーダル本体 */}
      <div className="relative bg-background w-full max-w-md rounded-t-2xl lg:rounded-2xl max-h-[90vh] flex flex-col shadow-xl">
        {/* ヘッダー */}
        <div className="flex items-center justify-between px-4 py-4 border-b shrink-0">
          <h2 className="font-semibold">写真を追加</h2>
          <button
            onClick={handleClose}
            disabled={uploading}
            className="rounded-full p-1 hover:bg-muted transition-colors disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* スクロール可能な中身 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {warningFilenames ? (
            /* アップロード完了・形式非対応の警告 */
            <div className="space-y-3 py-2">
              <div className="flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3">
                <TriangleAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-sm text-amber-800">
                  <p className="font-medium">この写真は形式の都合で正常に表示できない可能性があります</p>
                  <p className="text-xs mt-1 text-amber-700">
                    写真自体は保存されています。台帳・Excel等での見え方は後ほどご確認ください。
                  </p>
                </div>
              </div>
              <ul className="text-sm space-y-1 max-h-40 overflow-y-auto">
                {warningFilenames.map((name, i) => (
                  <li key={i} className="truncate text-muted-foreground">・{name}</li>
                ))}
              </ul>
            </div>
          ) : (
            <>
              {/* ファイル選択エリア */}
              {!uploading && (
                <div
                  className={cn(
                    'border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors min-h-[140px] px-4 py-4',
                    isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
                  )}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => inputRef.current?.click()}
                >
                  <ImagePlus className="h-9 w-9 text-muted-foreground" />
                  <p className="text-base font-medium text-center lg:hidden">
                    {selected.length > 0 ? 'タップしてさらに追加' : 'タップしてカメラロールから選択'}
                  </p>
                  <p className="hidden lg:block text-base font-medium text-center">
                    {selected.length > 0 ? 'クリックしてさらに追加' : '写真またはフォルダをここにドラッグ＆ドロップ'}
                  </p>
                  <p className="text-xs text-muted-foreground text-center lg:hidden">
                    スマホ標準カメラで撮った写真もあとから取り込めます
                  </p>
                  <p className="hidden lg:block text-xs text-muted-foreground text-center">
                    Windowsのフォルダごとドロップすると、フォルダ名で未分類フォルダを自動作成します
                  </p>
                  <p className="text-xs text-muted-foreground">JPG・PNG・HEIC対応</p>
                </div>
              )}

              {/* ファイル入力（非表示） */}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  handleFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />

              {/* 選択枚数・フェーズ別の内訳 */}
              {selected.length > 0 && !uploading && (
                <div className="text-sm">
                  <p className="font-medium">{selected.length}枚選択中</p>
                  <p className="text-xs text-muted-foreground">
                    施工前{countByPhase('before')}枚 / 施工中{countByPhase('during')}枚 / 施工後{countByPhase('after')}枚 / 未分類{countByPhase(null)}枚
                  </p>
                  {folderPaths.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      未分類フォルダ: {folderPaths.join('、')}
                    </p>
                  )}
                </div>
              )}

              {/* プレビューサムネイル */}
              {selected.length > 0 && !uploading && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selected.map((s, i) => (
                    <div key={i} className="shrink-0 space-y-1">
                      <img
                        src={s.preview}
                        alt={s.file.name}
                        className="h-16 w-16 rounded-md object-cover border"
                      />
                      {s.folderPath.length > 0 && s.phase === null && (
                        <p
                          className="w-16 text-[10px] text-muted-foreground truncate text-center"
                          title={s.folderPath.join(' / ')}
                        >
                          {s.folderPath.join(' / ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* 追加する写真の施工フェーズ */}
              {!uploading && (
                <div>
                  <p className="text-sm font-medium mb-2">追加する写真の施工フェーズ（一括指定）</p>
                  <div className="grid grid-cols-3 gap-2">
                    {PHASE_OPTIONS.map(({ value, label }) => (
                      <button
                        key={value}
                        onClick={() => setPhase(phase === value ? null : value)}
                        className={cn(
                          'py-3.5 rounded-xl border-2 text-sm font-medium transition-all active:scale-95',
                          phase === value
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border hover:border-primary/50 hover:bg-muted',
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  {!phase && (
                    <>
                      <p className="text-xs text-muted-foreground mt-1">
                        未分類として追加されます（アップロード後に個別設定も可能）
                      </p>
                      {/* 取り込み先フォルダ（未分類の時のみ）。Windowsフォルダごとドロップした
                          写真にはここで選んだフォルダより階層構造が優先される */}
                      <div className="mt-2 flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
                        <div className="min-w-0 flex items-center gap-2">
                          <FolderIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">取り込み先</p>
                            <p className="text-sm font-medium truncate">{destinationLabel}</p>
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => setShowFolderPicker(true)}
                        >
                          変更
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* アップロード中のプログレス */}
              {uploading && (
                <div className="space-y-3 py-4">
                  <p className="text-sm text-center font-medium">
                    アップロード中... {progress.done} / {progress.total}枚
                  </p>
                  <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all duration-300"
                      style={{
                        width: progress.total > 0 ? `${(progress.done / progress.total) * 100}%` : '0%',
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* フッターボタン */}
        <div className="px-4 py-4 border-t shrink-0 flex gap-3">
          {warningFilenames ? (
            <Button className="w-full" onClick={handleClose}>
              閉じる
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleClose}
                disabled={uploading}
              >
                キャンセル
              </Button>
              <Button
                className="flex-1"
                onClick={handleUpload}
                disabled={selected.length === 0 || uploading}
              >
                <Upload className="h-4 w-4" />
                {uploading ? '処理中...' : `アップロード開始`}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 取り込み先フォルダ選択（既存のFolderPickerSheetをそのまま再利用） */}
      <FolderPickerSheet
        open={showFolderPicker}
        folders={folders}
        folderLabel={folderPathLabel}
        onClose={() => setShowFolderPicker(false)}
        onSelect={(folderId) => {
          setDestinationFolderId(folderId)
          setShowFolderPicker(false)
        }}
        onCreateNew={() => {
          setShowFolderPicker(false)
          setCreatingFolderForUpload(true)
        }}
      />
      <FolderFormModal
        open={creatingFolderForUpload}
        title="新規フォルダを作成して取り込み先にする"
        submitLabel="作成して選択"
        onClose={() => setCreatingFolderForUpload(false)}
        onSubmit={handleCreateFolderForUpload}
      />
    </div>
  )
}
