import { useEffect, useRef, useState } from 'react'
import { Settings, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ExcelExportButton } from './ExcelExportButton'
import {
  isWindowsPlatform,
  loadExcelExportMode,
  resolveExcelExportMode,
  saveExcelExportMode,
  type ExcelExportMode,
} from '@/lib/excelExportMode'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props {
  project: Project
  photos: Photo[] // sort_order 昇順でソート済みの全写真
  /** 施工前・施工後の写真が各1枚以上あるとき true（施工前後比較ボタンの表示条件） */
  hasBeforeAfter: boolean
}

interface AnchorPos {
  top: number
  left: number
}

const PANEL_WIDTH = 288 // w-72

/**
 * Excel出力ボタン（標準台帳・大写真台帳・施工前後比較）と、出力方式の設定（歯車）。
 * 利用者は作りたい台帳を選ぶだけで、出力方式（標準 / Excel直接作成）は設定で切り替える。
 * 初期値は標準モード。設定は端末ごとに localStorage へ保存する。
 */
export function ExcelExportGroup({ project, photos, hasBeforeAfter }: Props) {
  const [windows] = useState(() => isWindowsPlatform())
  const [savedMode, setSavedMode] = useState<ExcelExportMode>(() => loadExcelExportMode())
  const mode = resolveExcelExportMode(savedMode, windows)

  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<AnchorPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const changeMode = (next: ExcelExportMode) => {
    setSavedMode(next)
    saveExcelExportMode(next)
  }

  // ヘッダーのボタン列は横スクロール（overflow-x-auto）のため、パネルは position: fixed で描画する
  // （ZIP出力ボタンと同じ方式）。開いている間にスクロール・リサイズしたら閉じる。
  const toggleOpen = () => {
    const rect = triggerRef.current?.getBoundingClientRect()
    // 歯車の左端にそろえ、画面右端からはみ出さないよう左へ寄せる
    setAnchor(rect ? { top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 8)) } : null)
    setOpen((v) => !v)
  }

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon"
        onClick={toggleOpen}
        className="relative h-8 w-8 shrink-0"
        aria-label="Excel出力方式の設定"
        aria-expanded={open}
        title={mode === 'direct' ? 'Excel出力方式：Excel直接作成モード' : 'Excel出力方式：標準モード'}
      >
        <Settings className="h-4 w-4" />
        {mode === 'direct' && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
        )}
      </Button>

      <ExcelExportButton project={project} photos={photos} layout="standard" mode={mode} onSwitchToStandard={() => changeMode('standard')} />
      <ExcelExportButton project={project} photos={photos} layout="large" mode={mode} onSwitchToStandard={() => changeMode('standard')} />
      {hasBeforeAfter && (
        <ExcelExportButton project={project} photos={photos} layout="beforeAfter" mode={mode} onSwitchToStandard={() => changeMode('standard')} />
      )}

      {open && (
        <>
          <div className="fixed inset-0 z-[69]" onClick={() => setOpen(false)} aria-hidden="true" />
          <div
            className="fixed z-[70] w-72 max-w-[calc(100vw-16px)]"
            style={anchor ? { top: anchor.top, left: anchor.left } : { top: 64, right: 16 }}
          >
            <ExcelExportSettingsPanel
              savedMode={savedMode}
              windows={windows}
              onChange={changeMode}
              onClose={() => setOpen(false)}
            />
          </div>
        </>
      )}
    </>
  )
}

interface PanelProps {
  savedMode: ExcelExportMode
  windows: boolean
  onChange: (mode: ExcelExportMode) => void
  onClose: () => void
}

/** 出力方式の設定パネル（表示のみ。状態は呼び出し側が持つ） */
export function ExcelExportSettingsPanel({ savedMode, windows, onChange, onClose }: PanelProps) {
  const effective = resolveExcelExportMode(savedMode, windows)
  const options: { mode: ExcelExportMode; title: string; description: string; disabled: boolean }[] = [
    {
      mode: 'standard',
      title: '標準モード',
      description: 'スマホ・PCで利用できます。',
      disabled: false,
    },
    {
      mode: 'direct',
      title: 'Excel直接作成モード',
      description: 'Windows版Excelと専用Helperが必要です。',
      disabled: !windows,
    },
  ]

  return (
    <div className="rounded-lg border bg-background shadow-lg text-sm" role="dialog" aria-label="Excel出力方式">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <p className="font-semibold">Excel出力方式</p>
        <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label="閉じる">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="py-1" role="radiogroup" aria-label="Excel出力方式">
        {options.map((opt) => {
          const checked = effective === opt.mode
          return (
            <button
              key={opt.mode}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={opt.disabled}
              onClick={() => onChange(opt.mode)}
              className={cn(
                'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
                opt.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted',
                checked && 'bg-primary/5',
              )}
            >
              <span
                className={cn(
                  'mt-0.5 h-4 w-4 rounded-full border-2 shrink-0',
                  checked ? 'border-primary bg-primary' : 'border-muted-foreground/40',
                )}
              />
              <span>
                <span className="block font-medium">{opt.title}</span>
                <span className="block text-xs text-muted-foreground">{opt.description}</span>
              </span>
            </button>
          )
        })}
      </div>

      <div className="px-3 py-2 border-t text-xs text-muted-foreground leading-relaxed space-y-1">
        {!windows ? (
          <p>
            この端末はWindowsではないため、Excel直接作成モードは利用できません。標準モードで出力されます。
          </p>
        ) : (
          <>
            <p>
              Excel直接作成モードでは、ダウンロードしたファイル（.genbafoto）を開くと、専用HelperがWindows版Excelで台帳を作成します。
            </p>
            <p>
              専用Helperがインストールされているかは、ブラウザからは確認できません。ファイルが開けない場合や作成できない場合は、標準モードに切り替えてください。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
