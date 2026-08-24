import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  folderName: string
  descendantFolderCount: number
  photoCount: number
  onCancel: () => void
  onKeepPhotos: () => void
  onDeletePhotos: () => void
}

/**
 * フォルダ削除の確認ダイアログ。「フォルダだけ削除（写真は未分類へ）」と
 * 「フォルダと写真を削除（写真も完全に削除）」の2択＋キャンセルを提示する。
 * 後者は取り消せない操作のため、赤枠・警告アイコンで視覚的に区別している。
 */
export function FolderDeleteConfirmModal({
  open,
  folderName,
  descendantFolderCount,
  photoCount,
  onCancel,
  onKeepPhotos,
  onDeletePhotos,
}: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />

      <div className="relative bg-background w-full max-w-sm rounded-t-2xl lg:rounded-2xl shadow-xl p-4 space-y-4">
        <div className="space-y-1">
          <h2 className="font-semibold">「{folderName}」を削除しますか？</h2>
          <p className="text-sm text-muted-foreground">
            {descendantFolderCount > 0 && `配下の${descendantFolderCount}個のフォルダと、`}
            {photoCount}枚の写真があります。
          </p>
        </div>

        <div className="space-y-2">
          <Button
            variant="outline"
            className="w-full h-auto flex-col items-start gap-0.5 py-2.5 px-3 text-left"
            onClick={onKeepPhotos}
          >
            <span className="font-medium">フォルダだけ削除</span>
            <span className="text-xs font-normal text-muted-foreground">写真は未分類へ戻します</span>
          </Button>

          {/* 危険操作：赤枠・警告アイコンで視覚的に区別する */}
          <button
            type="button"
            onClick={onDeletePhotos}
            className="w-full text-left rounded-lg border-2 border-destructive bg-destructive/5 px-3 py-2.5 hover:bg-destructive/10 active:scale-[0.99] transition-all"
          >
            <span className="font-medium text-destructive flex items-center gap-1.5">
              <TriangleAlert className="h-4 w-4 shrink-0" />
              フォルダと写真を削除
            </span>
            <span className="text-xs text-destructive/80">写真も完全に削除します（元に戻せません）</span>
          </button>

          <Button variant="ghost" className="w-full" onClick={onCancel}>
            キャンセル
          </Button>
        </div>
      </div>
    </div>
  )
}
