/**
 * Excel出力時の「写真の取得結果」の記録（標準・大判・施工前後で共通）。
 *
 * 写真が取得できなかった枠は従来どおり空欄のまま出力するが、黙って握りつぶさず、
 * Excel上の表記（No.12 / 施工前 No.12 など）と一緒に記録して、利用者へ知らせる。
 * 写真IDは利用者に見せない（label だけを表示する。photoId は内部の識別用）。
 * Excel ファイルの生成そのものの失敗は、ここでは扱わない（例外として呼び出し側へ伝わる）。
 */

export interface MissingPhoto {
  /** 内部の識別用。利用者向けの表示には使わない */
  photoId: string
  /** Excel上の表記（例: 「No.12」「施工前 No.12」） */
  label: string
}

export interface ImageReport {
  /** 画像を埋め込もうとした枚数 */
  total: number
  missing: MissingPhoto[]
}

export const newImageReport = (): ImageReport => ({ total: 0, missing: [] })

export interface ExcelExportResult {
  /** 出力対象の写真（画像を埋め込もうとした）枚数 */
  total: number
  /** 画像を取得できなかった写真（Excel上の表記） */
  missing: MissingPhoto[]
  /** Excelファイルを生成してダウンロードを開始したか（全件失敗のときは false） */
  downloaded: boolean
}

/** 全ての写真が取得できなかった（空欄だけのExcelになる）場合 */
export const isAllMissing = (report: ImageReport): boolean => report.total > 0 && report.missing.length >= report.total

/** 全件失敗ならダウンロードせず、それ以外は save() を呼ぶ。結果を返す */
export function completeExcelExport(report: ImageReport, save: () => void): ExcelExportResult {
  if (isAllMissing(report)) return { total: report.total, missing: report.missing, downloaded: false }
  save()
  return { total: report.total, missing: report.missing, downloaded: true }
}

export type ExcelPhotoNoticeKind = 'warning' | 'error'

export interface ExcelPhotoNotice {
  kind: ExcelPhotoNoticeKind
  /** 見出し */
  title: string
  /** 失敗枚数の行 */
  countLine: string
  /** 対象の表記（全件失敗のときは空） */
  labels: string[]
  /** 補足の案内 */
  hint: string
}

/** 結果から利用者向けの通知を作る。全件成功なら null。原因は断定しない */
export function buildExcelPhotoNotice(result: ExcelExportResult): ExcelPhotoNotice | null {
  const count = result.missing.length
  if (count === 0) return null
  const countLine = `取得失敗：${count}枚`
  if (!result.downloaded) {
    return {
      kind: 'error',
      title: '写真を取得できなかったため、Excel出力を中止しました。',
      countLine,
      labels: [],
      hint: '通信状態を確認して、もう一度お試しください。',
    }
  }
  // 同じ表記の重複は除く（順序は出力順のまま）
  const labels = [...new Set(result.missing.map((m) => m.label))]
  return {
    kind: 'warning',
    title: 'Excelファイルを生成しましたが、一部の写真を取得できませんでした。',
    countLine,
    labels,
    hint: '写真が空欄になっている可能性があります。提出前に内容をご確認ください。',
  }
}
