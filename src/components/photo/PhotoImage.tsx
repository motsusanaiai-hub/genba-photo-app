import { ImageOff } from 'lucide-react'
import { usePhotoImageSrc } from '@/hooks/usePhotoImageSrc'
import { cn } from '@/lib/utils'
import type { Photo } from '@/types/photo'

interface Props {
  photo: Pick<Photo, 'id' | 'thumbnail_data_url' | 'storage_path'>
  alt: string
  className?: string
  loading?: 'lazy' | 'eager'
}

/**
 * 写真の画像表示（一覧・カード・台帳・アクションシート・参照写真ピッカー）。
 * 端末内の画像があればそれを使い、なければクラウドの圧縮画像を本人の認証で取得して表示する（usePhotoImageSrc）。
 * 取得中は薄いプレースホルダー、取得に失敗したら画像アイコンの代替表示にする（画面全体は止めない）。
 * プレースホルダーは img と同じ className を持つため、レイアウトは変わらない。
 */
export function PhotoImage({ photo, alt, className, loading = 'lazy' }: Props) {
  const { src, status, onError } = usePhotoImageSrc(photo)

  if (status === 'ready' && src) {
    return <img src={src} alt={alt} className={className} loading={loading} onError={onError} />
  }

  return (
    <div
      role="img"
      aria-label={status === 'loading' ? `${alt}（読み込み中）` : `${alt}（画像を表示できません）`}
      data-photo-image-status={status}
      className={cn(
        className,
        'flex items-center justify-center bg-muted text-muted-foreground',
        status === 'loading' && 'animate-pulse',
      )}
    >
      {status === 'failed' && <ImageOff className="h-5 w-5 opacity-60" aria-hidden="true" />}
    </div>
  )
}
