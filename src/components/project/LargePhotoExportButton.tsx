import { Download, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExcelPageSelectModal } from './ExcelPageSelectModal'
import { useExcelPageExport } from '@/hooks/useExcelPageExport'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props {
  project: Project
  photos: Photo[]  // sort_order 昇順でソート済みの全写真
}

export function LargePhotoExportButton({ project, photos }: Props) {
  const { status, pickerPages, handleExportClick, confirmPage, cancelPicker } = useExcelPageExport<Photo>({
    // 動的インポートで ExcelJS チャンクを分離（初期バンドルに含まない）
    listPages: async (photos) => {
      const { listOneColumnExcelPages } = await import('@/lib/generateOneColumnExcel')
      return listOneColumnExcelPages(photos)
    },
    generate: async (project, photos, page) => {
      const { generateOneColumnExcel } = await import('@/lib/generateOneColumnExcel')
      await generateOneColumnExcel(project, photos, page)
    },
  })

  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Download className="h-4 w-4" />

  const label =
    status === 'loading' ? '生成中...' :
    status === 'error'   ? 'エラー'   :
                           '大写真（1×3）'

  return (
    <>
      <Button
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => handleExportClick(project, photos)}
        disabled={status === 'loading'}
        className="gap-1.5"
        aria-label="大写真（1×3）レイアウトでExcel出力"
      >
        {icon}
        {/* PC: テキストあり / モバイル: アイコンのみ */}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {pickerPages && (
        <ExcelPageSelectModal
          pages={pickerPages}
          formatLabel={(page, i) =>
            `${i + 1}ページ目　${PHASE_LABELS[page.groupIndex]}　写真${page.startNo}〜${page.endNo}`
          }
          onSelect={(page) => confirmPage(project, photos, page)}
          onCancel={cancelPicker}
        />
      )}
    </>
  )
}

const PHASE_LABELS = ['施工前', '施工中', '施工後']
