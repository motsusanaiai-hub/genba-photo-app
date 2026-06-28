import { get, set, del } from 'idb-keyval'

const DIR_HANDLE_KEY = 'genba-save-dir-handle'

export type SaveMode = 'fs-access' | 'share' | 'download'

/** 端末・ブラウザが対応している保存方式を判定 */
export function detectSaveMode(): SaveMode {
  if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) return 'fs-access'
  if (typeof navigator !== 'undefined' && 'share' in navigator) return 'share'
  return 'download'
}

/** IndexedDB に保存されたディレクトリハンドルを取得 */
export async function getStoredDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const handle = await get<FileSystemDirectoryHandle>(DIR_HANDLE_KEY)
    return handle ?? null
  } catch {
    return null
  }
}

/**
 * フォルダ選択ダイアログを開き、ハンドルを IndexedDB へ保存して返す。
 * キャンセル時は null を返す。Pictures を初期表示にするが任意フォルダを選択可能。
 */
export async function pickAndStoreDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handle = (await (window as any).showDirectoryPicker({
      mode: 'readwrite',
      startIn: 'pictures',
    })) as FileSystemDirectoryHandle
    await set(DIR_HANDLE_KEY, handle)
    return handle
  } catch (e) {
    if ((e as Error).name === 'AbortError') return null
    throw e
  }
}

/** 保存済みハンドルを削除（フォルダ変更時） */
export async function clearDirHandle(): Promise<void> {
  await del(DIR_HANDLE_KEY)
}

/**
 * ディレクトリハンドルの書き込み権限を確認・要求する。
 * requestPermission はユーザージェスチャー（クリックイベント）内で呼ぶこと。
 */
export async function ensureWritePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const perm = (await (handle as any).queryPermission({ mode: 'readwrite' })) as PermissionState
    if (perm === 'granted') return true
    if (perm === 'prompt') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (handle as any).requestPermission({ mode: 'readwrite' })) as PermissionState
      return result === 'granted'
    }
    return false
  } catch {
    return false
  }
}

/** ファイルをディレクトリへ書き込む */
export async function writeFileToDir(dir: FileSystemDirectoryHandle, file: File): Promise<void> {
  const fileHandle = await dir.getFileHandle(file.name, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(file)
  await writable.close()
}

/** Web Share API でファイルを共有（キャンセルは無視） */
export async function shareFile(file: File): Promise<boolean> {
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '撮影写真' })
      return true
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') {
      console.warn('[deviceFileSave] share failed:', e)
    }
  }
  return false
}

/** `<a download>` でファイルをダウンロード（Downloads フォルダへ） */
export function downloadFile(file: File): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = file.name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
