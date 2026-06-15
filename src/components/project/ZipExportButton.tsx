import { useState } from 'react'
import { Archive, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props {
  project: Project
  photos: Photo[]
}

type Status = 'idle' | 'loading' | 'error'

export function ZipExportButton({ project, photos }: Props) {
  const [status, setStatus] = useState<Status>('idle')

  const handleExport = async () => {
    if (status === 'loading') return
    setStatus('loading')
    try {
      // 動的インポートで JSZip チャンクを分離（初期バンドルに含まない）
      const { generateZip } = await import('@/lib/generateZip')
      await generateZip(project, photos)
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
    <Button
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="sm"
      onClick={handleExport}
      disabled={status === 'loading'}
      className="gap-1.5"
      aria-label="圧縮写真をまとめたZIPを出力"
    >
      {icon}
      {/* PC: テキストあり / モバイル: アイコンのみ */}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
