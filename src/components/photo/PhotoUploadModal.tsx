import { useEffect, useRef, useState } from 'react'
import { X, ImagePlus, Upload, TriangleAlert } from 'lucide-react'
import { usePhotos } from '@/hooks/usePhotos'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { Phase } from '@/types/photo'

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
}

interface SelectedFile {
  file: File
  preview: string
  phase: Phase | null
}

export function PhotoUploadModal({ open, onClose, projectId, defaultPhase }: Props) {
  const { uploadPhotosWithPhases } = usePhotos(projectId)
  const inputRef = useRef<HTMLInputElement>(null)

  const [selected, setSelected] = useState<SelectedFile[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [warningFilenames, setWarningFilenames] = useState<string[] | null>(null)

  // モーダルを開いた瞬間のページ側フェーズタブを初期選択に反映する。
  // 開いた後にページ側のタブが変わってもこの選択には追従させない。
  useEffect(() => {
    if (open) {
      setPhase(defaultPhase)
      setWarningFilenames(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  // 追加済みの選択は上書きせず、現在選択中のフェーズを各ファイルに記録して追加する
  const handleFiles = (incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith('image/') || f.name.match(/\.(heic|heif)$/i))
    if (images.length === 0) return
    const additions: SelectedFile[] = images.map((f) => ({
      file: f,
      preview: URL.createObjectURL(f),
      phase,
    }))
    setSelected((prev) => [...prev, ...additions])
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = () => setIsDragging(false)
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    handleFiles(Array.from(e.dataTransfer.files))
  }

  const handleUpload = async () => {
    if (selected.length === 0) return
    setUploading(true)
    setProgress({ done: 0, total: selected.length })
    const uploaded = await uploadPhotosWithPhases(
      selected.map(({ file, phase }) => ({ file, phase })),
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

  const countByPhase = (p: Phase | null) => selected.filter((s) => s.phase === p).length

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
                  <p className="text-base font-medium text-center">
                    {selected.length > 0 ? 'タップしてさらに追加' : 'タップしてカメラロールから選択'}
                  </p>
                  <p className="text-xs text-muted-foreground text-center">
                    スマホ標準カメラで撮った写真もあとから取り込めます
                  </p>
                  <p className="hidden lg:block text-xs text-muted-foreground">またはドラッグ＆ドロップ</p>
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
                </div>
              )}

              {/* プレビューサムネイル */}
              {selected.length > 0 && !uploading && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {selected.map((s, i) => (
                    <img
                      key={i}
                      src={s.preview}
                      alt={s.file.name}
                      className="h-16 w-16 rounded-md object-cover shrink-0 border"
                    />
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
                    <p className="text-xs text-muted-foreground mt-1">
                      未分類として追加されます（アップロード後に個別設定も可能）
                    </p>
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
    </div>
  )
}
