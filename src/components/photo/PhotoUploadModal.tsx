import { useRef, useState } from 'react'
import { X, ImagePlus, Upload } from 'lucide-react'
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
}

export function PhotoUploadModal({ open, onClose, projectId }: Props) {
  const { uploadPhotos } = usePhotos(projectId)
  const inputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [previews, setPreviews] = useState<string[]>([])
  const [phase, setPhase] = useState<Phase | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })

  if (!open) return null

  const handleFiles = (incoming: File[]) => {
    const images = incoming.filter((f) => f.type.startsWith('image/') || f.name.match(/\.(heic|heif)$/i))
    if (images.length === 0) return
    // 既存の preview URL を解放
    previews.forEach((url) => URL.revokeObjectURL(url))
    setFiles(images)
    setPreviews(images.map((f) => URL.createObjectURL(f)))
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
    if (files.length === 0) return
    setUploading(true)
    setProgress({ done: 0, total: files.length })
    await uploadPhotos(files, phase, (done, total) => setProgress({ done, total }))
    cleanup()
    onClose()
  }

  const cleanup = () => {
    previews.forEach((url) => URL.revokeObjectURL(url))
    setFiles([])
    setPreviews([])
    setPhase(null)
    setUploading(false)
    setProgress({ done: 0, total: 0 })
  }

  const handleClose = () => {
    if (uploading) return
    cleanup()
    onClose()
  }

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
          {/* ファイル選択エリア */}
          {!uploading && (
            <div
              className={cn(
                'border-2 border-dashed rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors min-h-[120px] px-4',
                isDragging ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/50',
              )}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => inputRef.current?.click()}
            >
              <ImagePlus className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-center">
                {files.length > 0
                  ? `${files.length}枚選択中　（タップで変更）`
                  : 'タップして選択　またはドラッグ＆ドロップ'}
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
            onChange={(e) => handleFiles(Array.from(e.target.files ?? []))}
          />

          {/* プレビューサムネイル */}
          {previews.length > 0 && !uploading && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {previews.map((url, i) => (
                <img
                  key={i}
                  src={url}
                  alt={files[i]?.name}
                  className="h-16 w-16 rounded-md object-cover shrink-0 border"
                />
              ))}
            </div>
          )}

          {/* フェーズ一括設定 */}
          {!uploading && (
            <div>
              <p className="text-sm font-medium mb-2">施工フェーズを一括設定</p>
              <div className="grid grid-cols-3 gap-2">
                {PHASE_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => setPhase(phase === value ? null : value)}
                    className={cn(
                      'py-3 rounded-xl border-2 text-sm font-medium transition-all active:scale-95',
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
                  未選択でもアップロード後に個別設定できます
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
        </div>

        {/* フッターボタン */}
        <div className="px-4 py-4 border-t shrink-0 flex gap-3">
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
            disabled={files.length === 0 || uploading}
          >
            <Upload className="h-4 w-4" />
            {uploading ? '処理中...' : `アップロード開始`}
          </Button>
        </div>
      </div>
    </div>
  )
}
