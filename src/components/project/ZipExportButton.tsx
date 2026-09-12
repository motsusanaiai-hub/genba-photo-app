import { useEffect, useRef, useState } from 'react'
import { Archive, Loader2, AlertCircle, ChevronDown, Image, Images } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import type { ZipExportMode } from '@/lib/generateZip'
import { cn } from '@/lib/utils'

interface Props {
  project: Project
  photos: Photo[]
}

type Status = 'idle' | 'loading' | 'error'

interface AnchorPos {
  top: number
  right: number
}

const MODES: { mode: ZipExportMode; label: string; sub: string }[] = [
  { mode: 'compressed', label: '圧縮画像のみ',     sub: 'Excel出力用サイズ' },
  { mode: 'original',   label: '元画像のみ',       sub: 'オリジナル解像度' },
  { mode: 'both',       label: '圧縮＋元画像',     sub: '両方まとめて' },
]

export function ZipExportButton({ project, photos }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<AnchorPos | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const NOT_ON_THIS_DEVICE = '元画像はこの端末に保存されていません。撮影した端末で出力してください。'

  // ヘッダー右側のボタン列は横スクロール対応のため overflow-x-auto になっており、
  // CSS仕様上 overflow-x が visible 以外だと overflow-y も自動的に auto 扱いになる。
  // そのためメニュー/警告を absolute（祖先基準）で配置するとヘッダーの高さでクリップされ、
  // 表示されない＝クリックできない状態になる。position: fixed + ボタン位置からの座標計算で
  // ヘッダーの overflow の外（ビューポート基準）に描画することでこれを回避する。
  const computeAnchor = (): AnchorPos | null => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return null
    return { top: rect.bottom + 4, right: window.innerWidth - rect.right }
  }

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v
      if (next) setAnchor(computeAnchor())
      return next
    })
  }

  // 開いている間にスクロール／リサイズが起きたらボタンとの位置がずれるため閉じる
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

  const handleExport = async (mode: ZipExportMode) => {
    setOpen(false)
    if (status === 'loading') return
    setStatus('loading')
    setWarning(null)
    setAnchor(computeAnchor())
    try {
      const { generateZip } = await import('@/lib/generateZip')
      const { created, missingOriginals, missingCompressed } = await generateZip(project, photos, mode)
      setStatus('idle')

      // 「元画像のみ」で1枚も見つからずZIP自体が作られなかった場合
      if (!created) {
        setWarning(NOT_ON_THIS_DEVICE)
        setTimeout(() => setWarning(null), 8000)
        return
      }

      if (missingOriginals > 0 || missingCompressed > 0) {
        const parts: string[] = []
        if (missingOriginals > 0) parts.push(`元画像${missingOriginals}枚をスキップしました（撮影した端末でのみ保存されています）`)
        if (missingCompressed > 0) parts.push(`圧縮画像${missingCompressed}枚を含められませんでした`)
        setWarning(parts.join(' / '))
        setTimeout(() => setWarning(null), 8000)
      }
    } catch (err) {
      console.error('[ZIP出力] failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Archive className="h-4 w-4" />

  const label =
    status === 'loading' ? '生成中...' :
    status === 'error'   ? 'エラー'   :
                           '写真ZIP'

  return (
    <div className="relative">
      <Button
        ref={triggerRef}
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={toggleOpen}
        disabled={status === 'loading'}
        className="gap-1"
        aria-label="写真ZIPを出力"
        aria-expanded={open}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform hidden sm:block', open && 'rotate-180')} />
      </Button>

      {warning && anchor && (
        <div
          style={{ position: 'fixed', top: anchor.top, right: anchor.right }}
          className="z-[71] bg-amber-50 border border-amber-300 text-amber-900 text-xs rounded-lg shadow-lg px-3 py-2 w-72 leading-snug"
        >
          {warning}
        </div>
      )}

      {open && anchor && (
        <>
          {/* 背景クリックで閉じる */}
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div
            style={{ position: 'fixed', top: anchor.top, right: anchor.right }}
            className="z-[71] bg-background border rounded-xl shadow-lg overflow-hidden w-52"
          >
            <p className="px-3 pt-2.5 pb-1 text-xs text-muted-foreground font-medium">出力内容を選択</p>
            {MODES.map(({ mode, label, sub }) => (
              <button
                key={mode}
                onClick={() => handleExport(mode)}
                className="w-full flex items-start gap-2.5 px-3 py-2.5 text-left hover:bg-muted transition-colors"
              >
                {mode === 'compressed' ? (
                  <Image className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                ) : mode === 'original' ? (
                  <Images className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Archive className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
                )}
                <div>
                  <p className="text-sm font-medium leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground leading-tight">{sub}</p>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
