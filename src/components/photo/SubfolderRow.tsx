import { Folder } from 'lucide-react'
import type { PhotoFolder } from '@/types/photo'

interface Props {
  folders: PhotoFolder[]
  photoCountByFolder: (folderId: string) => number
  onOpenFolder: (folderId: string) => void
}

/**
 * フォルダ中身表示中、直下のサブフォルダをタイルで表示する。
 * PhotoGrid/LedgerView（そのフォルダに直接入っている写真）の上に並べて、
 * サブフォルダと直下の写真を同じ画面でまとめて扱えるようにする
 * （Windows Explorer同様、フォルダの中にフォルダとファイルが混在する見た目）。
 * サブフォルダが無ければ何も表示しない。
 */
export function SubfolderRow({ folders, photoCountByFolder, onOpenFolder }: Props) {
  if (folders.length === 0) return null

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 p-3 border-b bg-muted/10">
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
    </div>
  )
}
