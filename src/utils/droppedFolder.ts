/**
 * Windows Explorer等からフォルダごとドラッグ＆ドロップされた際に、中のファイルを
 * 再帰的に読み取るためのユーティリティ（Drag and Drop Entries API / webkitGetAsEntry）。
 * Chrome・Edge等Chromium系デスクトップブラウザで利用可能。非対応ブラウザでは
 * 呼び出し元がフォールバック（dataTransfer.filesを直接使う）すること。
 */

export interface DroppedFile {
  file: File
  /**
   * ドロップされたフォルダの階層パス（例: ["6階", "外部"]）。
   * フォルダ経由でない単体ファイルの場合は空配列。
   */
  folderPath: string[]
}

/** 現在の環境がDrag and Drop Entries APIに対応しているか（items[0].webkitGetAsEntryの存在で判定） */
export function supportsDirectoryDrop(items: DataTransferItemList): boolean {
  return items.length > 0 && typeof items[0]?.webkitGetAsEntry === 'function'
}

/**
 * ドロップされたトップレベルのDataTransferItemたちからentryを取り出す。
 * DataTransferはドロップイベントハンドラを抜けると内容が無効化されるため、
 * webkitGetAsEntry()の呼び出しはawaitを挟まずイベントハンドラ内で同期的に行うこと
 * （このため本関数は非同期処理を含まない）。
 */
export function getTopLevelEntries(items: DataTransferItemList): FileSystemEntry[] {
  return Array.from(items)
    .map((item) => item.webkitGetAsEntry())
    .filter((entry): entry is FileSystemEntry => entry !== null)
}

/**
 * 1件のエントリ（ファイル or フォルダ）を再帰的に読み取り、中に含まれる全ファイルを
 * 階層パス付きで返す。トップレベルの呼び出しは parentPath=[] で行うこと。
 * フォルダに入るたびそのフォルダ名をパスへ積み増していくため、何階層ネストしていても
 * Windows側のフォルダ構成をそのままfolderPathとして再現できる
 * （現状の呼び出し側はfolderPath全体を使って多階層フォルダを作成する）。
 */
export async function readEntryRecursively(
  entry: FileSystemEntry,
  parentPath: string[],
): Promise<DroppedFile[]> {
  if (entry.isFile) {
    const file = await readFileEntry(entry as FileSystemFileEntry)
    return file ? [{ file, folderPath: parentPath }] : []
  }

  if (entry.isDirectory) {
    const path = [...parentPath, entry.name]
    const children = await readAllDirectoryEntries(entry as FileSystemDirectoryEntry)
    const nested = await Promise.all(children.map((child) => readEntryRecursively(child, path)))
    return nested.flat()
  }

  return []
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File | null> {
  return new Promise((resolve) => {
    entry.file(
      (file) => resolve(file),
      () => resolve(null),
    )
  })
}

/**
 * FileSystemDirectoryReader.readEntries() は仕様上・実装上1回の呼び出しで
 * ディレクトリ内の全件を返すとは限らない（Chromeは1回最大100件程度で打ち切ることがある）ため、
 * 空配列が返るまで繰り返し呼び出して全件を集める。
 */
function readAllDirectoryEntries(dirEntry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dirEntry.createReader()
  const all: FileSystemEntry[] = []

  return new Promise((resolve) => {
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all)
        } else {
          all.push(...batch)
          readBatch()
        }
      }, () => resolve(all))
    }
    readBatch()
  })
}
