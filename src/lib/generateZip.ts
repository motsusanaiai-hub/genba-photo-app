import JSZip from 'jszip'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { getPhotoJpegBlob, triggerBlobDownload } from '@/lib/generateExcel'

/** ZIP向けの出力順序：施工前→施工中→施工後→未分類（すべて出力対象） */
function orderedPhotosForZip(photos: Photo[]): Photo[] {
  return [
    ...photos.filter((p) => p.phase === 'before'),
    ...photos.filter((p) => p.phase === 'during'),
    ...photos.filter((p) => p.phase === 'after'),
    ...photos.filter((p) => p.phase == null),
  ]
}

/** zip の compressed/ フォルダに 001.jpg, 002.jpg... を追加する */
async function addCompressedPhotos(zip: JSZip, ordered: Photo[]): Promise<void> {
  const compressed = zip.folder('compressed')!
  const pad = Math.max(3, String(ordered.length).length)
  for (let i = 0; i < ordered.length; i++) {
    const blob = await getPhotoJpegBlob(ordered[i])
    if (blob) {
      compressed.file(`${String(i + 1).padStart(pad, '0')}.jpg`, blob)
    }
  }
}

/**
 * 圧縮写真一式（compressed/）をまとめた ZIP を生成・ダウンロードする。
 * 施工前→施工中→施工後→未分類の順で全写真を出力対象とする。
 */
export async function generateZip(project: Project, photos: Photo[]): Promise<void> {
  const zip = new JSZip()
  await addCompressedPhotos(zip, orderedPhotosForZip(photos))

  // JPEGは既に圧縮済みのため再圧縮しない
  const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerBlobDownload(content, `${safeName}_圧縮写真.zip`)
}
