import { Folder, FolderPlus, Image as ImageIcon } from 'lucide-react'
import type { PhotoFolder } from '@/types/photo'

interface Props {
  open: boolean
  folders: PhotoFolder[]
  // フォルダの表示名（階層がある場合は "6階 / 外部" のようなパス表記にするため呼び出し側から渡す）
  folderLabel: (folder: PhotoFolder) => string
  onClose: () => void
  onSelect: (folderId: string | null) => void
  onCreateNew: () => void
}

/**
 * 複数選択中の写真をどのフォルダへ移動するか選ぶボトムシート（未分類タブ専用）。
 * 階層に関わらずプロジェクト内の全フォルダをフラットな一覧として表示し、
 * ネストしたフォルダは "親 / 子" のパス表記で区別する（階層をたどらせず直接選べるようにするため）。
 */
export function FolderPickerSheet({ open, folders, folderLabel, onClose, onSelect, onCreateNew }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[66] flex items-end justify-center lg:items-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative bg-background w-full max-w-md rounded-t-2xl lg:rounded-2xl shadow-xl max-h-[80vh] flex flex-col pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="px-4 py-3 border-b shrink-0">
          <h2 className="font-semibold">フォルダへ移動</h2>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          <button
            onClick={onCreateNew}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm text-primary hover:bg-muted transition-colors"
          >
            <FolderPlus className="h-4 w-4" />
            新規フォルダを作成して移動
          </button>

          <button
            onClick={() => onSelect(null)}
            className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
          >
            <ImageIcon className="h-4 w-4 text-muted-foreground" />
            フォルダなし（未分類直下）
          </button>

          {folders.map((folder) => (
            <button
              key={folder.id}
              onClick={() => onSelect(folder.id)}
              className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-muted transition-colors"
            >
              <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="truncate">{folderLabel(folder)}</span>
            </button>
          ))}
        </div>

        <div className="border-t px-4 py-2 shrink-0">
          <button
            onClick={onClose}
            className="w-full py-2.5 rounded-lg text-sm font-medium text-muted-foreground hover:bg-muted transition-colors"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  )
}
