import JSZip from 'jszip'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { getPhotoJpegBlob, triggerBlobDownload } from '@/lib/generateExcel'
import { EXCEL_TEMPLATES, type ExcelTemplateId } from '@/lib/excelTemplates'

/**
 * Excel台帳 + 圧縮写真一式（compressed/）をまとめた ZIP を生成・ダウンロードする。
 * templateId で同梱するExcelレイアウトを切り替えられる（将来のテンプレート選択UI向け）。
 */
export async function generateZip(
  project: Project,
  photos: Photo[],
  templateId: ExcelTemplateId = 'standard',
): Promise<void> {
  const template = EXCEL_TEMPLATES[templateId]

  const wb = await template.buildWorkbook(project, photos)
  const excelBuffer = await wb.xlsx.writeBuffer()

  const zip = new JSZip()
  zip.file(template.filename, excelBuffer)

  // Excel側の「No.」と同じ順序・対象（未分類は除外、施工前→施工中→施工後）
  const ordered = [
    ...photos.filter((p) => p.phase === 'before'),
    ...photos.filter((p) => p.phase === 'during'),
    ...photos.filter((p) => p.phase === 'after'),
  ]

  const compressed = zip.folder('compressed')!
  const pad = Math.max(3, String(ordered.length).length)
  for (let i = 0; i < ordered.length; i++) {
    const blob = await getPhotoJpegBlob(ordered[i])
    if (blob) {
      compressed.file(`${String(i + 1).padStart(pad, '0')}.jpg`, blob)
    }
  }

  // Excel/JPEGとも既に圧縮済みのため再圧縮しない
  const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  triggerBlobDownload(content, `${safeName}_出力.zip`)
}
