import { useState } from 'react'
import { Download, Loader2, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'

interface Props {
  project: Project
  photos: Photo[]
}

type Status = 'idle' | 'loading' | 'error'

export function BeforeAfterExportButton({ project, photos }: Props) {
  const [status, setStatus] = useState<Status>('idle')

  const handleExport = async () => {
    if (status === 'loading') return
    setStatus('loading')
    try {
      const { generateBeforeAfterExcel } = await import('@/lib/generateBeforeAfterExcel')
      await generateBeforeAfterExcel(project, photos)
      setStatus('idle')
    } catch (err) {
      console.error('[施工前後出力] failed:', err)
      setStatus('error')
      setTimeout(() => setStatus('idle'), 3000)
    }
  }

  const icon =
    status === 'loading' ? <Loader2 className="h-4 w-4 animate-spin" /> :
    status === 'error'   ? <AlertCircle className="h-4 w-4" /> :
                           <Download className="h-4 w-4" />

  const label =
    status === 'loading' ? '生成中...' :
    status === 'error'   ? 'エラー'   :
                           '施工前後'

  return (
    <Button
      variant={status === 'error' ? 'destructive' : 'outline'}
      size="sm"
      onClick={handleExport}
      disabled={status === 'loading'}
      className="gap-1.5"
      aria-label="施工前後Excel出力"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  )
}
