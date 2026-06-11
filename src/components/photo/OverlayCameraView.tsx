import { useEffect, useRef, useState } from 'react'
import { Check, Eye, EyeOff, RefreshCw, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCameraStream, type CameraErrorReason } from '@/hooks/useCameraStream'
import { usePhotos } from '@/hooks/usePhotos'
import { photoStorage } from '@/lib/photoStorage'
import { captureVideoFrame, blobToFile } from '@/utils/cameraCapture'
import { Button } from '@/components/ui/button'
import type { Photo } from '@/types/photo'

const OPACITY_STORAGE_KEY = 'genba-overlay-capture-opacity'
const DEFAULT_OPACITY = 0.5
const MIN_SCALE = 0.3
const MAX_SCALE = 4
const ZOOM_STEP = 0.1

interface Transform {
  x: number
  y: number
  scale: number
}

const DEFAULT_TRANSFORM: Transform = { x: 0, y: 0, scale: 1 }

function loadStoredOpacity(): number {
  const saved = localStorage.getItem(OPACITY_STORAGE_KEY)
  if (saved === null) return DEFAULT_OPACITY
  const parsed = Number(saved)
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : DEFAULT_OPACITY
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

interface Props {
  beforePhoto: Photo
  projectId: string
  onChangeBeforePhoto: () => void
  onClose: () => void
}

export function OverlayCameraView({ beforePhoto, projectId, onChangeBeforePhoto, onClose }: Props) {
  const { videoRef, status, error, retry } = useCameraStream()
  const { uploadPhotos } = usePhotos(projectId)

  const [overlayUrl, setOverlayUrl] = useState<string | null>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [opacity, setOpacity] = useState(loadStoredOpacity)
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM)
  const [isSaving, setIsSaving] = useState(false)
  const [justCaptured, setJustCaptured] = useState(false)
  const [captureCount, setCaptureCount] = useState(0)

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<{
    mode: 'pan' | 'pinch' | 'none'
    base: Transform
    start: { x: number; y: number }
    startDist: number
  }>({ mode: 'none', base: DEFAULT_TRANSFORM, start: { x: 0, y: 0 }, startDist: 0 })

  // 施工前写真の原本（フルサイズ）を読み込む。なければサムネイルにフォールバック
  useEffect(() => {
    let revoke: string | null = null
    photoStorage.getObjectURL(beforePhoto.id).then((url) => {
      if (url) {
        revoke = url
        setOverlayUrl(url)
      } else {
        setOverlayUrl(beforePhoto.thumbnail_data_url)
      }
    })
    return () => {
      if (revoke) URL.revokeObjectURL(revoke)
    }
  }, [beforePhoto.id, beforePhoto.thumbnail_data_url])

  // 透明度の最終値を保存
  useEffect(() => {
    localStorage.setItem(OPACITY_STORAGE_KEY, String(opacity))
  }, [opacity])

  // 「撮影完了」表示を一定時間後に消す
  useEffect(() => {
    if (!justCaptured) return
    const timer = setTimeout(() => setJustCaptured(false), 1200)
    return () => clearTimeout(timer)
  }, [justCaptured])

  const handlePointerDown = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (pointers.current.size === 1) {
      gesture.current = { mode: 'pan', base: transform, start: { x: e.clientX, y: e.clientY }, startDist: 0 }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = { mode: 'pinch', base: transform, start: { x: 0, y: 0 }, startDist: pointerDistance(a, b) }
    }
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const points = [...pointers.current.values()]

    if (gesture.current.mode === 'pan' && points.length === 1) {
      const dx = points[0].x - gesture.current.start.x
      const dy = points[0].y - gesture.current.start.y
      setTransform({ ...gesture.current.base, x: gesture.current.base.x + dx, y: gesture.current.base.y + dy })
    } else if (gesture.current.mode === 'pinch' && points.length === 2) {
      const ratio = pointerDistance(points[0], points[1]) / gesture.current.startDist
      setTransform({ ...gesture.current.base, scale: clampScale(gesture.current.base.scale * ratio) })
    }
  }

  const handlePointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size === 1) {
      const point = [...pointers.current.values()][0]
      gesture.current = { mode: 'pan', base: transform, start: point, startDist: 0 }
    } else {
      gesture.current.mode = 'none'
    }
  }

  const handleZoom = (delta: number) => {
    setTransform((t) => ({ ...t, scale: clampScale(t.scale + delta) }))
  }

  const handleReset = () => setTransform(DEFAULT_TRANSFORM)

  const handleCapture = async () => {
    const video = videoRef.current
    if (!video || status !== 'ready' || isSaving) return

    setIsSaving(true)
    try {
      const blob = await captureVideoFrame(video)
      const file = blobToFile(blob, `after_${Date.now()}.jpg`)
      await uploadPhotos([file], 'after', () => {})
      setCaptureCount((c) => c + 1)
      setJustCaptured(true)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] bg-black flex flex-col">
      {/* 上部バー */}
      <div className="flex items-center justify-between gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 bg-black/60 shrink-0 relative z-30">
        <Button
          variant="ghost"
          size="sm"
          className="text-white hover:bg-white/10 hover:text-white"
          onClick={onChangeBeforePhoto}
        >
          <RefreshCw className="h-4 w-4" />
          施工前写真を変更
        </Button>

        <div className="flex items-center gap-3">
          {captureCount > 0 && (
            <span className="text-white/70 text-xs">{captureCount}枚撮影済み</span>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={onClose}
          >
            完了
          </Button>
        </div>
      </div>

      {/* カメラ映像 + オーバーレイ */}
      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted autoPlay className="absolute inset-0 w-full h-full object-cover" />

        {(status === 'idle' || status === 'requesting') && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-4 border-white/30 border-t-white animate-spin" />
          </div>
        )}

        {status === 'error' && <CameraErrorView reason={error} onRetry={retry} />}

        {status === 'ready' && overlayUrl && (
          <div
            className="absolute inset-0 touch-none"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              src={overlayUrl}
              alt="施工前写真（オーバーレイ）"
              draggable={false}
              className="absolute left-1/2 top-1/2 max-w-full max-h-full w-auto h-auto select-none pointer-events-none"
              style={{
                opacity: showOverlay ? opacity : 0,
                transform: `translate(-50%, -50%) translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
              }}
            />
          </div>
        )}

        {/* 撮影完了トースト */}
        {justCaptured && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center gap-2 bg-black/70 text-white px-4 py-2 rounded-full pointer-events-none">
            <Check className="h-5 w-5 text-green-400" />
            撮影完了
          </div>
        )}
      </div>

      {/* 下部操作バー */}
      <div className="shrink-0 bg-black/60 px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-3 relative z-30">
        {/* 透明度スライダー */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowOverlay((v) => !v)}
            className="text-white/80 hover:text-white transition-colors shrink-0"
            aria-label={showOverlay ? 'オーバーレイを隠す' : 'オーバーレイを表示'}
            aria-pressed={showOverlay}
          >
            {showOverlay ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            disabled={!showOverlay}
            className="flex-1 accent-primary disabled:opacity-40"
            aria-label="オーバーレイの透明度"
          />
          <span className="text-white/70 text-xs w-10 text-right shrink-0">{Math.round(opacity * 100)}%</span>
        </div>

        {/* 位置調整 + シャッター */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-1.5 justify-self-start">
            <button
              onClick={() => handleZoom(-ZOOM_STEP)}
              className="h-9 w-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              aria-label="オーバーレイを縮小"
            >
              <ZoomOut className="h-4 w-4" />
            </button>
            <button
              onClick={() => handleZoom(ZOOM_STEP)}
              className="h-9 w-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              aria-label="オーバーレイを拡大"
            >
              <ZoomIn className="h-4 w-4" />
            </button>
            <button
              onClick={handleReset}
              className="h-9 w-9 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
              aria-label="位置と拡大率をリセット"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={handleCapture}
            disabled={status !== 'ready' || isSaving}
            className="h-16 w-16 rounded-full bg-white border-4 border-white/30 flex items-center justify-center active:scale-95 transition-transform disabled:opacity-50"
            aria-label="撮影"
          >
            {isSaving && <span className="h-6 w-6 rounded-full border-2 border-black/30 border-t-black animate-spin" />}
          </button>

          <div />
        </div>
      </div>
    </div>
  )
}

function CameraErrorView({ reason, onRetry }: { reason: CameraErrorReason | null; onRetry: () => void }) {
  const message =
    reason === 'permission'
      ? 'カメラへのアクセスが許可されていません。ブラウザの設定でカメラの利用を許可してください。'
      : reason === 'not-found'
        ? 'カメラが見つかりませんでした。'
        : reason === 'unsupported'
          ? 'このブラウザはカメラ撮影に対応していません。'
          : 'カメラを起動できませんでした。'

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 p-6 text-center">
      <p className="text-white/90 text-sm max-w-xs">{message}</p>
      {reason !== 'unsupported' && (
        <Button variant="secondary" onClick={onRetry}>
          再試行
        </Button>
      )}
    </div>
  )
}
