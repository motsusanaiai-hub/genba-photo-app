import { useRef, useState } from 'react'
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

const MODES: { mode: ZipExportMode; label: string; sub: string }[] = [
  { mode: 'compressed', label: '圧縮画像のみ',     sub: 'Excel出力用サイズ' },
  { mode: 'original',   label: '元画像のみ',       sub: 'オリジナル解像度' },
  { mode: 'both',       label: '圧縮＋元画像',     sub: '両方まとめて' },
]

export function ZipExportButton({ project, photos }: Props) {
  const [status, setStatus] = useState<Status>('idle')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const handleExport = async (mode: ZipExportMode) => {
    setOpen(false)
    if (status === 'loading') return
    setStatus('loading')
    try {
      const { generateZip } = await import('@/lib/generateZip')
      await generateZip(project, photos, mode)
      setStatus('idle')
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
    <div ref={ref} className="relative">
      <Button
        variant={status === 'error' ? 'destructive' : 'outline'}
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={status === 'loading'}
        className="gap-1"
        aria-label="写真ZIPを出力"
        aria-expanded={open}
      >
        {icon}
        <span className="hidden sm:inline">{label}</span>
        <ChevronDown className={cn('h-3 w-3 transition-transform hidden sm:block', open && 'rotate-180')} />
      </Button>

      {open && (
        <>
          {/* 背景クリックで閉じる */}
          <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-[71] bg-background border rounded-xl shadow-lg overflow-hidden w-52">
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
