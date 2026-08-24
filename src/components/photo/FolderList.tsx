import { Folder, FolderPlus, Image as ImageIcon } from 'lucide-react'
import type { PhotoFolder } from '@/types/photo'
import { Button } from '@/components/ui/button'

interface Props {
  folders: PhotoFolder[]
  photoCountByFolder: (folderId: string) => number
  noFolderCount: number
  onOpenFolder: (folderId: string | null) => void
  onCreateFolder: () => void
}

/**
 * 未分類タブ内のフォルダ一覧（タイル表示）。
 * 「フォルダなし（未分類直下）」を常に末尾の擬似フォルダとして表示し、
 * どちらもタップでその中身（通常のグリッド/台帳表示）を開く。
 */
export function FolderList({ folders, photoCountByFolder, noFolderCount, onOpenFolder, onCreateFolder }: Props) {
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">未分類の写真をフォルダで整理できます</p>
        <Button size="sm" variant="outline" onClick={onCreateFolder} className="gap-1.5 shrink-0">
          <FolderPlus className="h-4 w-4" />
          新規フォルダ
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
        {folders.map((folder) => (
          <button
            key={folder.id}
            onClick={() => onOpenFolder(folder.id)}
            className="flex flex-col items-start gap-1 rounded-xl border p-3 text-left hover:bg-muted active:scale-[0.98] transition-all"
          >
            <Folder className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm font-medium truncate w-full">{folder.name}</span>
            <span className="text-xs text-muted-foreground">{photoCountByFolder(folder.id)}枚</span>
          </button>
        ))}

        {/* フォルダなし（未分類直下）。常に末尾に固定表示する擬似フォルダ */}
        <button
          onClick={() => onOpenFolder(null)}
          className="flex flex-col items-start gap-1 rounded-xl border border-dashed p-3 text-left hover:bg-muted active:scale-[0.98] transition-all"
        >
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <span className="text-sm font-medium">フォルダなし</span>
          <span className="text-xs text-muted-foreground">{noFolderCount}枚</span>
        </button>
      </div>

      {folders.length === 0 && (
        <p className="text-xs text-muted-foreground text-center py-6">
          フォルダはまだありません。「新規フォルダ」から作成できます。
        </p>
      )}
    </div>
  )
}
