import { useEffect, useRef, useState } from 'react'
import { Columns2, FileSpreadsheet, Image as ImageIcon, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExcelPageSelectModal } from './ExcelPageSelectModal'
import { useExcelPageExport } from '@/hooks/useExcelPageExport'
import { identityPhotos, pairsToPhotos } from '@/lib/genbafotoPageItems'
import type { ExcelPageInfo } from '@/lib/generateExcel'
import type { Pair } from '@/lib/generateBeforeAfterExcel'
import type { GenbafotoTemplateType } from '@/lib/generateGenbafotoJob'
import type { ExcelExportMode } from '@/lib/excelExportMode'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

export type ExcelLayout = 'standard' | 'large' | 'beforeAfter'

/**
 * 台帳の種類ごとの設定。どちらの出力方式でも「対象写真・ページ分割・無料版の1ページ制限」は
 * 同じ listPages と useExcelPageExport を通すため、方式によって出力対象がずれることはない。
 */
interface LayoutConfig<T> {
  label: string
  Icon: typeof FileSpreadsheet
  templateType: GenbafotoTemplateType
  listPages: (photos: Photo[]) => Promise<ExcelPageInfo<T>[]>
  /** 標準モード（ブラウザ内の ExcelJS）での生成 */
  generateStandard: (project: Project, photos: Photo[], page?: ExcelPageInfo<T>) => Promise<void>
  /** Excel直接作成モードで .genbafoto に渡す写真へ変換（ページ選択時） */
  pageItemsToPhotos: (items: T[]) => Photo[]
  formatPageLabel: (page: ExcelPageInfo<T>, index: number) => string
}

const PHASE_LABELS = ['施工前', '施工中', '施工後']

// ExcelJS チャンクを初期バンドルに含めないよう、生成処理は動的 import でラップする
const STANDARD: LayoutConfig<Photo> = {
  label: '標準台帳',
  Icon: FileSpreadsheet,
  templateType: 'standard',
  listPages: async (photos) => (await import('@/lib/generateExcel')).listStandardExcelPages(photos),
  generateStandard: async (project, photos, page) => (await import('@/lib/generateExcel')).generateExcel(project, photos, page),
  pageItemsToPhotos: identityPhotos,
  formatPageLabel: (page, i) => `${i + 1}ページ目　${PHASE_LABELS[page.groupIndex]}　写真${page.startNo}〜${page.endNo}`,
}

const LARGE: LayoutConfig<Photo> = {
  label: '大写真台帳',
  Icon: ImageIcon,
  templateType: 'large',
  listPages: async (photos) => (await import('@/lib/generateOneColumnExcel')).listOneColumnExcelPages(photos),
  generateStandard: async (project, photos, page) =>
    (await import('@/lib/generateOneColumnExcel')).generateOneColumnExcel(project, photos, page),
  pageItemsToPhotos: identityPhotos,
  formatPageLabel: (page, i) => `${i + 1}ページ目　${PHASE_LABELS[page.groupIndex]}　写真${page.startNo}〜${page.endNo}`,
}

const BEFORE_AFTER: LayoutConfig<Pair> = {
  label: '施工前後比較',
  Icon: Columns2,
  templateType: 'beforeAfter',
  listPages: async (photos) => (await import('@/lib/generateBeforeAfterExcel')).listBeforeAfterExcelPages(photos),
  generateStandard: async (project, photos, page) =>
    (await import('@/lib/generateBeforeAfterExcel')).generateBeforeAfterExcel(project, photos, page),
  pageItemsToPhotos: pairsToPhotos,
  formatPageLabel: (page, i) => `${i + 1}ページ目　No.${page.startNo}〜${page.endNo}`,
}

interface Props {
  project: Project
  photos: Photo[] // sort_order 昇順でソート済みの全写真
  layout: ExcelLayout
  /** 実際に使う出力方式（Windows 以外では常に standard が渡される） */
  mode: ExcelExportMode
  /** Excel直接作成モードが使えなかった場合に「標準モードへ切り替える」案内から呼ぶ */
  onSwitchToStandard: () => void
}

export function ExcelExportButton({ layout, ...rest }: Props) {
  if (layout === 'standard') return <LayoutExportButton config={STANDARD} {...rest} />
  if (layout === 'large') return <LayoutExportButton config={LARGE} {...rest} />
  return <LayoutExportButton config={BEFORE_AFTER} {...rest} />
}

type Message = { type: 'success' | 'error'; text: string; offerStandard: boolean }

interface AnchorPos {
  top: number
  left: number
}

const MESSAGE_WIDTH = 288 // w-72

function LayoutExportButton<T>({
  config,
  project,
  photos,
  mode,
  onSwitchToStandard,
}: Omit<Props, 'layout'> & { config: LayoutConfig<T> }) {
  const [message, setMessage] = useState<Message | null>(null)
  const [anchor, setAnchor] = useState<AnchorPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // ヘッダーのボタン列は横スクロール（overflow-x-auto）のため、メッセージを absolute で置くと
  // ヘッダーの高さでクリップされる。ZIP出力ボタンと同じく position: fixed で描画する。
  // ボタンの右端にそろえつつ、スマホなど狭い画面でも左右が画面外に出ないよう位置を補正する。
  const showMessage = (next: Message, ms: number) => {
    const rect = triggerRef.current?.getBoundingClientRect()
    const width = Math.min(MESSAGE_WIDTH, window.innerWidth - 16)
    setAnchor(
      rect
        ? { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) }
        : null,
    )
    setMessage(next)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setMessage(null), ms)
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  const { status, pickerPages, handleExportClick, confirmPage, cancelPicker } = useExcelPageExport<T>({
    listPages: config.listPages,
    generate: async (project, photos, page) => {
      setMessage(null)
      if (mode === 'standard') {
        await config.generateStandard(project, photos, page)
        return
      }

      // Excel直接作成モード（高互換出力）：既存の .genbafoto 生成処理をそのまま使う
      const targetPhotos = page ? config.pageItemsToPhotos(page.items) : photos
      const { generateGenbafotoJob } = await import('@/lib/generateGenbafotoJob')
      const result = await generateGenbafotoJob(project, targetPhotos, config.templateType)
      if (result.ok) {
        showMessage(
          {
            type: 'success',
            text:
              `${result.filename} をダウンロードしました。開くとWindows版Excelで台帳が作成されます（専用Helperが必要です）。` +
              '開けない場合は、標準モードで作成してください。',
            offerStandard: true,
          },
          12000,
        )
        return
      }
      // result.message は内部情報（token・signed URL等）を含まない利用者向けの固定文言
      showMessage({ type: 'error', text: result.message, offerStandard: true }, 12000)
      // useExcelPageExport 側の status も 'error' にするため投げる
      throw new Error(result.message)
    },
  })

  const { Icon } = config
  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Icon className="h-4 w-4" />
  const label =
    status === 'loading' ? '作成中...' :
    status === 'error'   ? 'エラー'   :
                           config.label

  const modeText = mode === 'direct' ? 'Excel直接作成モード' : '標準モード'

  return (
    <>
      <Button
        ref={triggerRef}
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => handleExportClick(project, photos)}
        disabled={status === 'loading'}
        className="gap-1.5"
        aria-label={`${config.label}をExcel出力（${modeText}）`}
        title={`${config.label}をExcel出力（${modeText}）`}
      >
        {icon}
        {/* PC: テキストあり / スマホ: アイコンのみ（従来のExcel出力ボタンと同じ。台帳ごとにアイコンを分けている） */}
        <span className="hidden sm:inline">{label}</span>
      </Button>

      {message && (
        <div
          role="status"
          className={
            'fixed z-[71] rounded-lg shadow-lg px-3 py-2 w-72 max-w-[calc(100vw-16px)] text-xs leading-snug border ' +
            (message.type === 'success'
              ? 'bg-green-50 border-green-300 text-green-900'
              : 'bg-red-50 border-red-300 text-red-900')
          }
          style={anchor ? { top: anchor.top, left: anchor.left } : { top: 64, right: 8 }}
        >
          <p>{message.text}</p>
          {message.offerStandard && (
            <button
              type="button"
              className="mt-2 underline font-medium"
              onClick={() => {
                setMessage(null)
                onSwitchToStandard()
              }}
            >
              標準モードに切り替える
            </button>
          )}
        </div>
      )}

      {pickerPages && (
        <ExcelPageSelectModal
          pages={pickerPages}
          formatLabel={config.formatPageLabel}
          onSelect={(page) => confirmPage(project, photos, page)}
          onCancel={cancelPicker}
        />
      )}
    </>
  )
}
