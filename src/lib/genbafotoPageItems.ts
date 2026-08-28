import type { Photo } from '@/types/photo'
import type { Pair } from '@/lib/generateBeforeAfterExcel'

// GenbafotoExportButton（Excel高互換出力ボタン）が、既存Excel出力と全く同じ
// listPages関数（listStandardExcelPages等）から得たページitemsを、
// generateGenbafotoJobへ渡すPhoto[]へ変換するための小さな純粋関数。
// ProjectDetailPage.tsx から利用するほか、単体テストからも直接importできるよう
// 独立したファイルに切り出している（ProjectDetailPage.tsx自体は依存が重く、
// テストから直接importするのが実用的ではないため）。

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
