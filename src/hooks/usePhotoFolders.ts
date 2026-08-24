import { useAuthStore } from '@/store/authStore'
import { useFolderStore } from '@/store/folderStore'
import { usePhotoStore } from '@/store/photoStore'
import { insertCloudFolders, updateCloudFolder, deleteCloudFolder } from '@/lib/cloudSync'
import type { PhotoFolder } from '@/types/photo'

/** rootId自身とその子孫（再帰的に全階層）のフォルダIDを集める */
function collectDescendantIds(allFolders: PhotoFolder[], rootId: string): string[] {
  const result = [rootId]
  const stack = [rootId]
  while (stack.length > 0) {
    const currentId = stack.pop()!
    for (const child of allFolders.filter((f) => f.parent_folder_id === currentId)) {
      result.push(child.id)
      stack.push(child.id)
    }
  }
  return result
}

export type FolderDeleteMode = 'keepPhotos' | 'deletePhotos'

/**
 * 未分類タブ内で写真を整理するためのフォルダ（photo_folders）のCRUD。
 * 階層化対応：parent_folder_id===null（またはundefined）がトップレベル。
 * 写真自体の folder_id 書き換え（移動）は usePhotos.moveToFolder が担当する
 * （写真の変更はusePhotos、フォルダ自体の変更はここ、と役割を分けている）。
 *
 * removePhotos（usePhotos由来の複数写真完全削除関数）を呼び出し側から受け取る。
 * 「フォルダと写真を削除」時、フォルダ削除専用の別の（IndexedDB/Storage/Supabaseの
 * 一部だけを消すような不完全な）削除処理を新設せず、既存の写真削除処理をそのまま
 * 再利用するための依存注入。渡されなければ「フォルダと写真を削除」は使えない
 * （呼び出し側が対応していない場合の安全側フォールバック）。
 */
export function usePhotoFolders(projectId: string, removePhotos?: (ids: string[]) => Promise<void>) {
  const user = useAuthStore((s) => s.user)
  const { folders, addFolder, updateFolder, deleteFolder } = useFolderStore()
  const { photos, updatePhoto } = usePhotoStore()

  const projectFolders = folders
    .filter((f) => f.project_id === projectId)
    .sort((a, b) => a.sort_order - b.sort_order)

  const maxSortOrder = projectFolders.length
    ? Math.max(...projectFolders.map((f) => f.sort_order))
    : 0

  // フォルダ「直下」の未分類写真の枚数（サブフォルダの中身は含まない。
  // フォルダ一覧タイル・フォルダ中身表示のサブフォルダタイルの両方で使う）
  const photoCountByFolder = (folderId: string): number =>
    photos.filter((p) => p.project_id === projectId && p.phase === null && p.folder_id === folderId).length

  // フォルダの祖先を辿って表示用パス文字列を作る（例: "6階 / 外部"）。
  // フォルダ移動先選択（FolderPickerSheet）等、階層を意識させたい場面で使う。
  const folderPathLabel = (folder: PhotoFolder): string => {
    const names: string[] = [folder.name]
    let current: PhotoFolder | undefined = folder
    while (current?.parent_folder_id) {
      const parent = projectFolders.find((f) => f.id === current!.parent_folder_id)
      if (!parent) break
      names.unshift(parent.name)
      current = parent
    }
    return names.join(' / ')
  }

  // フォルダ削除の確認ダイアログ表示用：対象フォルダ自身を除いた子孫フォルダ数と、
  // 対象フォルダ＋子孫フォルダ直下に「現在所属している」（folder_idが一致する）写真の枚数。
  // previous_folder_id経由の写真（今は別フェーズに分類中で、戻り先として記憶しているだけ）は
  // ここではカウントしない＝「フォルダと写真を削除」の削除対象にも含めない
  // （ユーザーの想定する「フォルダに入っている写真」とは異なるため）。
  const getFolderDeletionInfo = (id: string): { descendantFolderCount: number; photoCount: number } => {
    const idsToRemove = collectDescendantIds(projectFolders, id)
    const idsSet = new Set(idsToRemove)
    const photoCount = photos.filter(
      (p) => p.project_id === projectId && p.folder_id && idsSet.has(p.folder_id),
    ).length
    return { descendantFolderCount: idsToRemove.length - 1, photoCount }
  }

  const createFolder = async (name: string, parentFolderId: string | null = null): Promise<PhotoFolder> => {
    const now = new Date().toISOString()
    const folder: PhotoFolder = {
      id: crypto.randomUUID(),
      project_id: projectId,
      user_id: user?.id ?? '',
      name,
      parent_folder_id: parentFolderId,
      sort_order: maxSortOrder + 1000,
      created_at: now,
      updated_at: now,
    }
    addFolder(folder)
    await insertCloudFolders([folder])
    return folder
  }

  const renameFolder = async (id: string, name: string) => {
    updateFolder(id, { name })
    await updateCloudFolder(id, { name })
  }

  // フォルダ削除：フォルダ自身とその子孫（サブフォルダ）を全て削除する。
  // mode==='keepPhotos'（既定）：中の写真は削除せず未分類直下へ戻す（folder_id: null）。
  // mode==='deletePhotos'：対象フォルダ＋子孫フォルダに直接入っている写真も完全に削除する
  //   （usePhotos.removePhotosを再利用。IndexedDB原本・600px圧縮版・Supabase Storage・
  //   Supabase photosテーブル・ローカルstateを全て削除する既存経路そのまま）。
  // どちらのmodeでも、このフォルダ（または子孫）をprevious_folder_idとして参照している
  // 写真（＝今は別フェーズに分類中で、未分類に戻った時の復帰先として記憶している写真）は
  // 参照だけnull化する（削除はしない。deletePhotosモードでも「今フォルダに入っている写真」
  // ではないため削除対象に含めない）。
  // クラウド側は photo_folders.parent_folder_id の on delete cascade により
  // idを指定した1回のdeleteだけで子孫フォルダ行も自動的に削除され、
  // photos.folder_id/previous_folder_id は on delete set null で自動的にnullへ戻る。
  // ローカルstateはこの連鎖を自動追従しないため、ここで明示的に同じ範囲を処理する。
  const removeFolder = async (id: string, mode: FolderDeleteMode = 'keepPhotos') => {
    const idsToRemove = collectDescendantIds(projectFolders, id)
    const idsSet = new Set(idsToRemove)

    const directPhotoIds = photos
      .filter((p) => p.project_id === projectId && p.folder_id && idsSet.has(p.folder_id))
      .map((p) => p.id)

    if (mode === 'deletePhotos' && removePhotos) {
      await removePhotos(directPhotoIds)
    } else {
      directPhotoIds.forEach((photoId) => updatePhoto(photoId, { folder_id: null }))
    }

    const affectedByPreviousFolderId = photos
      .filter((p) => p.project_id === projectId && p.previous_folder_id && idsSet.has(p.previous_folder_id))
      .map((p) => p.id)
    affectedByPreviousFolderId.forEach((photoId) => updatePhoto(photoId, { previous_folder_id: null }))

    idsToRemove.forEach((folderId) => deleteFolder(folderId))
    // idのみ削除リクエストを送れば、子孫フォルダ行はクラウド側のon delete cascadeで連鎖削除される
    await deleteCloudFolder(id)
  }

  return {
    folders: projectFolders,
    photoCountByFolder,
    folderPathLabel,
    getFolderDeletionInfo,
    createFolder,
    renameFolder,
    removeFolder,
  }
}
