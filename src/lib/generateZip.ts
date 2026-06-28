import JSZip from 'jszip'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { getPhotoJpegBlob, triggerBlobDownload } from '@/lib/generateExcel'
import { photoStorage } from '@/lib/photoStorage'

export type ZipExportMode = 'compressed' | 'original' | 'both'

const PHASE_FOLDER: Record<string, string> = {
  before: '施工前',
  during: '施工中',
  after:  '施工後',
  unclassified: '未分類',
}

function phaseFolder(photo: Photo): string {
  return PHASE_FOLDER[photo.phase ?? 'unclassified']
}

/** ZIP向けの出力順序：施工前→施工中→施工後→未分類 */
function orderedPhotosForZip(photos: Photo[]): Photo[] {
  return [
    ...photos.filter((p) => p.phase === 'before'),
    ...photos.filter((p) => p.phase === 'during'),
    ...photos.filter((p) => p.phase === 'after'),
    ...photos.filter((p) => p.phase == null),
  ]
}

/** フェーズ別サブフォルダに連番ファイルを追加する */
async function addCompressedPhotos(root: JSZip, ordered: Photo[]): Promise<void> {
  const folder = root.folder('compressed')!
  const counters: Record<string, number> = {}
  for (const photo of ordered) {
    const phase = phaseFolder(photo)
    counters[phase] = (counters[phase] ?? 0) + 1
    const blob = await getPhotoJpegBlob(photo)
    if (blob) {
      const num = String(counters[phase]).padStart(3, '0')
      folder.folder(phase)!.file(`${num}.jpg`, blob)
    }
  }
}

/** original/ フォルダに元画像（IndexedDB）を追加する */
async function addOriginalPhotos(root: JSZip, ordered: Photo[]): Promise<void> {
  const folder = root.folder('original')!
  const counters: Record<string, number> = {}
  for (const photo of ordered) {
    const phase = phaseFolder(photo)
    counters[phase] = (counters[phase] ?? 0) + 1
    const blob = await photoStorage.getBlob(photo.id)
    if (blob) {
      const num = String(counters[phase]).padStart(3, '0')
      const ext = photo.original_filename.split('.').pop()?.toLowerCase() ?? 'jpg'
      folder.folder(phase)!.file(`${num}.${ext}`, blob)
    }
  }
}

/**
 * 写真をまとめた ZIP を生成・ダウンロードする。
 * mode: 'compressed' = 圧縮のみ / 'original' = 元画像のみ / 'both' = 両方
 */
export async function generateZip(
  project: Project,
  photos: Photo[],
  mode: ZipExportMode = 'compressed',
): Promise<void> {
  const ordered = orderedPhotosForZip(photos)
  const zip = new JSZip()

  if (mode === 'compressed' || mode === 'both') {
    await addCompressedPhotos(zip, ordered)
  }
  if (mode === 'original' || mode === 'both') {
    await addOriginalPhotos(zip, ordered)
  }

  const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  const suffix = mode === 'compressed' ? '圧縮写真' : mode === 'original' ? '元画像' : '写真一式'
  triggerBlobDownload(content, `${safeName}_${suffix}.zip`)
}
