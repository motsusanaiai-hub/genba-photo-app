// Excel出力方式の設定（端末ごと・localStorage）。
//
//   standard … 標準モード（通常出力）。ブラウザ内のExcelJSでxlsxを生成する。スマホ・PCで利用可能。初期値。
//   direct   … Excel直接作成モード（高互換出力）。.genbafoto をダウンロードし、
//              Windows Helper（GenbaFoto Excel Helper）＋ Windows版Excel（COM）で台帳を作成する。
//
// Helper がインストールされているかどうかはブラウザから確実には判定できないため、
// 「Windows のときだけ選べる」「選んだ人だけが使う」設計にしている。
// Windows 以外では、保存値が direct でも実際の出力は標準モードになる（resolveExcelExportMode）。

export type ExcelExportMode = 'standard' | 'direct'

/** 既存の設定キー（genba-view-mode 等）と衝突しない専用キー */
export const EXCEL_EXPORT_MODE_STORAGE_KEY = 'genba-excel-export-mode'

export const DEFAULT_EXCEL_EXPORT_MODE: ExcelExportMode = 'standard'

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** 保存済みの出力方式を読む。未保存・不正な値・読み取り不可（プライベートモード等）の場合は標準モード。 */
export function loadExcelExportMode(storage: ReadableStorage | null = defaultStorage()): ExcelExportMode {
  try {
    const raw = storage?.getItem(EXCEL_EXPORT_MODE_STORAGE_KEY)
    return raw === 'direct' || raw === 'standard' ? raw : DEFAULT_EXCEL_EXPORT_MODE
  } catch {
    return DEFAULT_EXCEL_EXPORT_MODE
  }
}

/** 出力方式を保存する。保存できなかった場合は false（画面上の選択はそのまま使える）。 */
export function saveExcelExportMode(mode: ExcelExportMode, storage: WritableStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false
    storage.setItem(EXCEL_EXPORT_MODE_STORAGE_KEY, mode)
    return true
  } catch {
    return false
  }
}

export interface PlatformInfo {
  userAgent: string
  /** navigator.userAgentData.platform（対応ブラウザのみ） */
  uaDataPlatform?: string
}

function currentPlatform(): PlatformInfo | null {
  if (typeof navigator === 'undefined') return null
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData
  return { userAgent: navigator.userAgent ?? '', uaDataPlatform: uaData?.platform }
}

/**
 * Windows（Excel直接作成モードを使える可能性がある環境）かどうか。
 * Helper の有無までは判定できない。
 */
export function isWindowsPlatform(info: PlatformInfo | null = currentPlatform()): boolean {
  if (!info) return false
  if (info.uaDataPlatform) return info.uaDataPlatform === 'Windows'
  return /Windows NT/i.test(info.userAgent) && !/Windows Phone/i.test(info.userAgent)
}

/** 実際に使う出力方式。Excel直接作成モードは Windows のときだけ有効。 */
export function resolveExcelExportMode(saved: ExcelExportMode, windows: boolean): ExcelExportMode {
  return saved === 'direct' && windows ? 'direct' : 'standard'
}
