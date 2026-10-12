// Excel写真台帳のファイル名（Web標準モード）。
//
// 直接作成モードの Windows Helper 1.1.0（excel_com_poc の SanitizeProjectNameForFile / BuildOutputBaseName）と
// 同じ規則・同じ順番にして、どちらの出力方式でも同じファイル名になるようにする：
//   1. 前後の空白を除く（全角スペースを含む）
//   2. 制御文字（U+0000〜U+001F）と \ / : * ? " < > | を「_」に置き換える
//   3. 空なら「現場フォト」
//   4. 最大100文字（UTF-16の単位。サロゲートペアを途中で切らない）。切った後の末尾の空白は除く
// → 「{工事名}_標準台帳.xlsx」「{工事名}_大判台帳.xlsx」「{工事名}_施工前後台帳.xlsx」
//
// 同名ファイルの連番はブラウザ側に任せる。選択ページ出力でもページ番号は付けない。

export type ExcelLedgerKind = 'standard' | 'large' | 'beforeAfter'

export const DEFAULT_PROJECT_FILE_NAME = '現場フォト'
export const MAX_PROJECT_FILE_NAME_LENGTH = 100

const LEDGER_SUFFIX: Record<ExcelLedgerKind, string> = {
  standard: '標準台帳',
  large: '大判台帳',
  beforeAfter: '施工前後台帳',
}

// eslint-disable-next-line no-control-regex
const INVALID_FILE_NAME_CHARS = /[\u0000-\u001F\\/:*?"<>|]/g

/** ファイル名に使う工事名部分（上の規則 1〜4） */
export function sanitizeProjectNameForFile(name: string | null | undefined): string {
  let s = (name ?? '').trim().replace(INVALID_FILE_NAME_CHARS, '_')
  if (s.length === 0) return DEFAULT_PROJECT_FILE_NAME
  if (s.length > MAX_PROJECT_FILE_NAME_LENGTH) {
    let len = MAX_PROJECT_FILE_NAME_LENGTH
    const last = s.charCodeAt(len - 1)
    if (last >= 0xd800 && last <= 0xdbff) len-- // 上位サロゲートで終わる場合は、その1文字分を切る
    s = s.slice(0, len).trimEnd()
    if (s.length === 0) return DEFAULT_PROJECT_FILE_NAME
  }
  return s
}

/** 台帳のファイル名：{工事名}_標準台帳.xlsx / {工事名}_大判台帳.xlsx / {工事名}_施工前後台帳.xlsx */
export function excelLedgerFileName(projectName: string | null | undefined, kind: ExcelLedgerKind): string {
  return `${sanitizeProjectNameForFile(projectName)}_${LEDGER_SUFFIX[kind]}.xlsx`
}
