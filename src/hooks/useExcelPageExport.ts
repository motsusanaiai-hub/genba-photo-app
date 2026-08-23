import { useState } from 'react'
import { useAuthStore } from '@/store/authStore'
import { canExportAllExcelPages } from '@/lib/plan'
import type { ExcelPageInfo } from '@/lib/generateExcel'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

type Status = 'idle' | 'loading' | 'error'

interface Options<T> {
  /**
   * そのレイアウトのページ一覧を返す関数（listStandardExcelPages等）。
   * ページ選択UIと生成処理が同じ結果を参照する。ExcelJSチャンクを初期バンドルに
   * 含めないよう、呼び出し側で `await import('@/lib/generateExcel')` した中身を
   * 返す想定のため、戻り値はPromiseを許容する。
   */
  listPages: (photos: Photo[]) => ExcelPageInfo<T>[] | Promise<ExcelPageInfo<T>[]>
  /** そのレイアウトの実際の生成関数（generateExcel等）。pageを渡さなければ従来通り全ページ出力する。 */
  generate: (project: Project, photos: Photo[], page?: ExcelPageInfo<T>) => Promise<void>
}

/**
 * Excel出力ボタン共通のプラン判定・ページ選択ロジック。
 * 3種類（標準・大写真・施工前後）のExportButtonで、plan判定・ページ選択・
 * キャンセル処理が将来ズレないよう、ここに集約する。
 *
 * - pro：ページ引数を渡さず、従来通り全ページを一括出力する（既存動作と完全に同じ）
 * - free / ads_removed：
 *   - ページ数が0または1 → 制限をかけず、proと同じ「ページ引数なし」のパスで直接出力する
 *     （1ページしかない場合に無意味な選択操作をさせないため。0ページ時は既存の
 *       「出力対象写真なし」の表示と同一の結果になる）
 *   - ページ数が2以上 → 選択モーダルを開き、選んだページだけを出力する
 */
export function useExcelPageExport<T>({ listPages, generate }: Options<T>) {
  const plan = useAuthStore((s) => s.user?.plan ?? 'free')
  const [status, setStatus] = useState<Status>('idle')
  const [pickerPages, setPickerPages] = useState<ExcelPageInfo<T>[] | null>(null)

  const runGenerate = async (project: Project, photos: Photo[], page?: ExcelPageInfo<T>) => {
    setStatus('loading')
    try {
      await generate(project, photos, page)
      setStatus('idle')
    } catch (err) {
      console.error('[Excel出力] failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const handleExportClick = async (project: Project, photos: Photo[]) => {
    if (status === 'loading') return

    if (canExportAllExcelPages(plan)) {
      await runGenerate(project, photos)
      return
    }

    const pages = await listPages(photos)
    if (pages.length <= 1) {
      await runGenerate(project, photos)
      return
    }
    setPickerPages(pages)
  }

  const confirmPage = (project: Project, photos: Photo[], page: ExcelPageInfo<T>) => {
    setPickerPages(null)
    void runGenerate(project, photos, page)
  }

  const cancelPicker = () => setPickerPages(null)

  return { status, pickerPages, handleExportClick, confirmPage, cancelPicker }
}
