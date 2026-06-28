import { useEffect, useState } from 'react'
import {
  detectSaveMode,
  getStoredDirHandle,
  pickAndStoreDirHandle,
  clearDirHandle,
  ensureWritePermission,
  writeFileToDir,
  shareFile,
  downloadFile,
  type SaveMode,
} from '@/utils/deviceFileSave'

export type DeviceSavePhase = 'idle' | 'saving' | 'saved' | 'error'

export function useDeviceSave() {
  const [saveMode] = useState<SaveMode>(detectSaveMode)
  const [dirHandle, setDirHandle] = useState<FileSystemDirectoryHandle | null>(null)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [savePhase, setSavePhase] = useState<DeviceSavePhase>('idle')

  // fs-access 対応時は IndexedDB からハンドルを復元
  useEffect(() => {
    if (saveMode === 'fs-access') {
      getStoredDirHandle().then(setDirHandle)
    }
  }, [saveMode])

  // 保存完了 → 2.5 秒後に自動クリア
  useEffect(() => {
    if (savePhase !== 'saved') return
    const t = setTimeout(() => {
      setPendingFiles([])
      setSavePhase('idle')
    }, 2500)
    return () => clearTimeout(t)
  }, [savePhase])

  /** 撮影後に保存対象ファイルをセットしてバナーを表示する */
  const queueFiles = (files: File[]) => {
    if (files.length === 0) return
    setPendingFiles(files)
    setSavePhase('idle')
  }

  /** 設定済みフォルダへ直接書き込む */
  const handleSaveToDir = async () => {
    if (!dirHandle || pendingFiles.length === 0) return
    setSavePhase('saving')
    try {
      const ok = await ensureWritePermission(dirHandle)
      if (!ok) {
        // 権限切れ → ハンドルをクリアして設定画面に戻す
        await clearDirHandle()
        setDirHandle(null)
        setSavePhase('idle')
        return
      }
      for (const file of pendingFiles) {
        await writeFileToDir(dirHandle, file)
      }
      setSavePhase('saved')
    } catch (e) {
      console.error('[deviceSave] write failed:', e)
      setSavePhase('error')
      setTimeout(() => setSavePhase('idle'), 3000)
    }
  }

  /** フォルダ選択ダイアログを開き、選択後に即保存する（初回 / 変更時） */
  const handlePickFolderAndSave = async () => {
    try {
      const handle = await pickAndStoreDirHandle()
      if (!handle) return // キャンセル
      setDirHandle(handle)
      if (pendingFiles.length > 0) {
        setSavePhase('saving')
        for (const file of pendingFiles) {
          await writeFileToDir(handle, file)
        }
        setSavePhase('saved')
      }
    } catch (e) {
      console.error('[deviceSave] pick+save failed:', e)
      setSavePhase('error')
      setTimeout(() => setSavePhase('idle'), 3000)
    }
  }

  /** 保存先フォルダをクリアして再選択を促す */
  const handleChangeFolder = async () => {
    await clearDirHandle()
    setDirHandle(null)
  }

  /** Web Share API / download フォールバック */
  const handleFallbackSave = async () => {
    if (pendingFiles.length === 0) return
    if (saveMode === 'share') {
      // ファイル一括共有を試みる
      try {
        if (navigator.canShare?.({ files: pendingFiles })) {
          await navigator.share({ files: pendingFiles, title: '撮影写真' })
        } else {
          for (const file of pendingFiles) {
            await shareFile(file)
          }
        }
      } catch (e) {
        if ((e as Error).name !== 'AbortError') console.warn('[deviceSave] share failed:', e)
      }
    } else {
      for (const file of pendingFiles) {
        downloadFile(file)
      }
      setPendingFiles([])
    }
  }

  /** バナーを閉じる */
  const dismiss = () => {
    setPendingFiles([])
    setSavePhase('idle')
  }

  return {
    saveMode,
    dirHandle,
    pendingFiles,
    savePhase,
    queueFiles,
    handleSaveToDir,
    handlePickFolderAndSave,
    handleChangeFolder,
    handleFallbackSave,
    dismiss,
  }
}
