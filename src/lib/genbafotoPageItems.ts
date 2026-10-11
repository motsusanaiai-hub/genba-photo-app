import type { Photo } from '@/types/photo'
import type { Pair } from '@/lib/generateBeforeAfterExcel'

// ExcelExportButton の Excel直接作成モード（高互換出力）が、標準モードと全く同じ
// listPages関数（listStandardExcelPages等）から得たページitemsを、
// generateGenbafotoJobへ渡すPhoto[]へ変換するための小さな純粋関数。
// 単体テストからも直接importできるよう、独立したファイルに切り出している。

/** ページitemsがそのままPhoto[]である場合（標準・大写真）の恒等変換。 */
export function identityPhotos(items: Photo[]): Photo[] {
  return items
}

/**
 * 施工前後ページ（Pair[]）を、generateGenbafotoJobへ渡すPhoto[]へ変換する。
 * 片方が欠けている組（beforeまたはafterのみ）もあるため、存在する写真だけを取り出す。
 * 並び順はlistBeforeAfterExcelPagesが確定させた順（ペアごとにbefore→after）のまま変更しない。
 */
export function pairsToPhotos(items: Pair[]): Photo[] {
  return items.flatMap((pair) => [pair.before, pair.after].filter((p): p is Photo => p != null))
}
