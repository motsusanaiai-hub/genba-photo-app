import { Download, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExcelPageSelectModal } from './ExcelPageSelectModal'
import { useExcelPageExport } from '@/hooks/useExcelPageExport'
import type { Pair } from '@/lib/generateBeforeAfterExcel'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props {
  project: Project
  photos: Photo[]
}

export function BeforeAfterExportButton({ project, photos }: Props) {
  const { status, pickerPages, handleExportClick, confirmPage, cancelPicker } = useExcelPageExport<Pair>({
    listPages: async (photos) => {
      const { listBeforeAfterExcelPages } = await import('@/lib/generateBeforeAfterExcel')
      return listBeforeAfterExcelPages(photos)
    },
    generate: async (project, photos, page) => {
      const { generateBeforeAfterExcel } = await import('@/lib/generateBeforeAfterExcel')
      await generateBeforeAfterExcel(project, photos, page)
    },
  })

  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Download className="h-4 w-4" />

  const label =
    status === 'loading' ? '生成中...' :
    status === 'error'   ? 'エラー'   :
                           '前後比較'

  return (
    <>
      <Button
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => handleExportClick(project, photos)}
        disabled={status === 'loading'}
        className="gap-1.5"
        aria-label="前後比較レイアウトでExcel出力"
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {pickerPages && (
        <ExcelPageSelectModal
          pages={pickerPages}
          formatLabel={(page, i) => `${i + 1}ページ目　No.${page.startNo}〜${page.endNo}`}
          onSelect={(page) => confirmPage(project, photos, page)}
          onCancel={cancelPicker}
        />
      )}
    </>
  )
}
