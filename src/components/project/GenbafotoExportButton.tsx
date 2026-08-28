import { useState } from 'react'
import { Monitor, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExcelPageSelectModal } from './ExcelPageSelectModal'
import { useExcelPageExport } from '@/hooks/useExcelPageExport'
import type { ExcelPageInfo } from '@/lib/generateExcel'
import type { GenbafotoTemplateType } from '@/lib/generateGenbafotoJob'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props<T> {
  project: Project
  photos: Photo[]
  templateType: GenbafotoTemplateType
  /** そのレイアウトのページ一覧を返す関数（listStandardExcelPages等、既存Excel出力と全く同じもの）。 */
  listPages: (photos: Photo[]) => ExcelPageInfo<T>[] | Promise<ExcelPageInfo<T>[]>
  /**
   * ページ選択後のitems（標準/大写真はPhoto[]、施工前後はPair[]）を
   * generateGenbafotoJobへ渡すPhoto[]へ変換する。対象写真の集合・並び順は
   * 既存Excel出力（listPages）が確定させたものをそのまま使い、ここでは並べ替えない。
   */
  pageItemsToPhotos: (items: T[]) => Photo[]
}

type Message = { type: 'success' | 'error'; text: string }

/**
 * 「Excel高互換出力」（Windows版Excel向け、.genbafotoダウンロード）の導線。
 * 既存の標準/大写真/施工前後Excel出力ボタンの隣に並べて表示する、小さな追加ボタン。
 *
 * 対象写真・ページ選択・無料/有料制限は、既存Excel出力と全く同じ
 * listPages関数（listStandardExcelPages等）とuseExcelPageExportフックを
 * そのまま再利用することで、既存Excel出力と対象写真が食い違わないようにしている。
 * 既存の3つのExcel出力ボタン（ExportButton等）・生成ロジック（generateExcel.ts等）は
 * 一切変更していない。
 */
export function GenbafotoExportButton<T>({ project, photos, templateType, listPages, pageItemsToPhotos }: Props<T>) {
  const [message, setMessage] = useState<Message | null>(null)

  const { status, pickerPages, handleExportClick, confirmPage, cancelPicker } = useExcelPageExport<T>({
    listPages,
    generate: async (project, photos, page) => {
      setMessage(null)
      const targetPhotos = page ? pageItemsToPhotos(page.items) : photos

      const { generateGenbafotoJob } = await import('@/lib/generateGenbafotoJob')
      const result = await generateGenbafotoJob(project, targetPhotos, templateType)

      if (result.ok) {
        setMessage({ type: 'success', text: `${result.filename} をダウンロードしました。` })
        setTimeout(() => setMessage(null), 6000)
        return
      }

      // result.message はgenerateGenbafotoJob側で用意した、内部情報を含まない
      // ユーザー向け固定文言（token・signed URL・storage_path等は一切含まない）。
      setMessage({ type: 'error', text: result.message })
      setTimeout(() => setMessage(null), 8000)
      // useExcelPageExport側のstatusも'error'にするため、ここで投げる
      // （console.errorは既存フック側の1行のみ。ここでは新たに追加しない）。
      throw new Error(result.message)
    },
  })

  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Monitor className="h-4 w-4" />

  const label =
    status === 'loading' ? '準備中...' :
    status === 'error'   ? 'エラー'   :
                           'Excel高互換出力'

  return (
    <div className="relative">
      <Button
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => handleExportClick(project, photos)}
        disabled={status === 'loading'}
        className="gap-1.5"
        aria-label="Excel高互換出力（Windows版Excel向け）"
        title="Windows版Excel向けの高互換出力（.genbafotoファイルをダウンロードします）"
      >
        {icon}
        {/* PC: テキストあり / モバイル: アイコンのみ */}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {message && (
        <div
          className={
            'absolute right-0 top-full mt-1 z-[71] rounded-lg shadow-lg px-3 py-2 w-72 text-xs leading-snug border ' +
            (message.type === 'success'
              ? 'bg-green-50 border-green-300 text-green-900'
              : 'bg-red-50 border-red-300 text-red-900')
          }
        >
          {message.text}
        </div>
      )}

      {pickerPages && (
        <ExcelPageSelectModal
          pages={pickerPages}
          formatLabel={(page, i) => `${i + 1}ページ目　写真${page.startNo}〜${page.endNo}`}
          onSelect={(page) => confirmPage(project, photos, page)}
          onCancel={cancelPicker}
        />
      )}
    </div>
  )
}
