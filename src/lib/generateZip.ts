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

/**
 * JSZip はフォルダ・ファイルの日時を内部で Date#getUTC* から読み取って ZIP に埋め込むが、
 * ZIP形式のDOS日時にはタイムゾーン情報が無く、Windowsエクスプローラ等はその値を
 * そのままローカル時刻として表示する。そのため補正無しでは実際の時刻より
 * ローカルタイムゾーンのオフセット分だけ早い時刻（JSTなら9時間前）に見えてしまう。
 * getTimezoneOffset() 分だけ時刻をずらし、getUTC* で読み取った値が本来のローカル時刻の
 * 値と一致するようにする。
 */
function toZipDate(date: Date): Date {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
}

/** 指定パスのフォルダ／ファイルエントリの日時を補正する（無ければ何もしない） */
function setEntryDate(zip: JSZip, path: string, date: Date): void {
  const entry = zip.files[path]
  if (entry) entry.date = date
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

/** フェーズ別サブフォルダに連番ファイルを追加する。戻り値は取得できなかった写真の枚数 */
async function addCompressedPhotos(root: JSZip, ordered: Photo[], zipDate: Date): Promise<number> {
  const folder = root.folder('compressed')!
  setEntryDate(root, 'compressed/', zipDate)
  const counters: Record<string, number> = {}
  let missing = 0
  for (const photo of ordered) {
    const phase = phaseFolder(photo)
    counters[phase] = (counters[phase] ?? 0) + 1
    const blob = await getPhotoJpegBlob(photo)
    if (blob) {
      const num = String(counters[phase]).padStart(3, '0')
      folder.folder(phase)!.file(`${num}.jpg`, blob, { date: zipDate })
      setEntryDate(root, `compressed/${phase}/`, zipDate)
    } else {
      missing++
      console.warn('[generateZip] compressed blob not found for photo:', photo.id, photo.original_filename)
    }
  }
  return missing
}

/** original/ フォルダに元画像（IndexedDB）を追加する。戻り値は取得できなかった写真の枚数 */
async function addOriginalPhotos(root: JSZip, ordered: Photo[], zipDate: Date): Promise<number> {
  const folder = root.folder('original')!
  setEntryDate(root, 'original/', zipDate)
  const counters: Record<string, number> = {}
  let missing = 0
  for (const photo of ordered) {
    const phase = phaseFolder(photo)
    counters[phase] = (counters[phase] ?? 0) + 1
    const blob = await photoStorage.getBlob(photo.id)
    if (blob) {
      const num = String(counters[phase]).padStart(3, '0')
      const ext = photo.original_filename.split('.').pop()?.toLowerCase() ?? 'jpg'
      folder.folder(phase)!.file(`${num}.${ext}`, blob, { date: zipDate })
      setEntryDate(root, `original/${phase}/`, zipDate)
    } else {
      missing++
      console.warn('[generateZip] original blob not found in IndexedDB for photo:', photo.id, photo.original_filename)
    }
  }
  return missing
}

export interface ZipExportResult {
  /** ZIPファイルが実際に生成・ダウンロードされたか */
  created: boolean
  /** 元画像がこの端末（IndexedDB）に見つからず含められなかった枚数（撮影端末以外で出力した場合など） */
  missingOriginals: number
  /** 圧縮画像が取得できず含められなかった枚数 */
  missingCompressed: number
  /** 出力対象の総枚数 */
  totalPhotos: number
}

/**
 * 写真をまとめた ZIP を生成・ダウンロードする。
 * mode: 'compressed' = 圧縮のみ / 'original' = 元画像のみ / 'both' = 両方
 *
 * 元画像はこの端末のIndexedDBにのみ保存されるため、撮影端末以外で 'original'/'both' を
 * 実行すると見つからない場合がある。'original' で1枚も見つからない場合はZIPを生成しない。
 */
export async function generateZip(
  project: Project,
  photos: Photo[],
  mode: ZipExportMode = 'compressed',
): Promise<ZipExportResult> {
  const ordered = orderedPhotosForZip(photos)
  const totalPhotos = ordered.length
  const zip = new JSZip()

  // compressed/original で同じ日時になるよう、ZIP出力時点の時刻を1つだけ生成して共有する
  const zipDate = toZipDate(new Date())

  let missingCompressed = 0
  let missingOriginals = 0

  if (mode === 'compressed' || mode === 'both') {
    missingCompressed = await addCompressedPhotos(zip, ordered, zipDate)
  }
  if (mode === 'original' || mode === 'both') {
    missingOriginals = await addOriginalPhotos(zip, ordered, zipDate)
  }

  // 「元画像のみ」で1枚も見つからない場合は空のZIPを作らない
  if (mode === 'original' && totalPhotos > 0 && missingOriginals === totalPhotos) {
    return { created: false, missingOriginals, missingCompressed, totalPhotos }
  }

  const content = await zip.generateAsync({ type: 'blob', compression: 'STORE' })
  const safeName = project.name.replace(/[\\/:*?"<>|]/g, '_')
  const suffix = mode === 'compressed' ? '圧縮写真' : mode === 'original' ? '元画像' : '写真一式'
  triggerBlobDownload(content, `${safeName}_${suffix}.zip`)

  return { created: true, missingOriginals, missingCompressed, totalPhotos }
}
