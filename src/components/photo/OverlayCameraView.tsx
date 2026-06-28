import { useEffect, useRef, useState } from 'react'
import {
  Check, Eye, EyeOff, RefreshCw, RotateCcw, ZoomIn, ZoomOut,
  PictureInPicture2, Layers,
} from 'lucide-react'
import { useCameraStream, type CameraErrorReason } from '@/hooks/useCameraStream'
import { usePhotos } from '@/hooks/usePhotos'
import { useDeviceSave } from '@/hooks/useDeviceSave'
import { photoStorage } from '@/lib/photoStorage'
import { captureVideoFrame, blobToFile } from '@/utils/cameraCapture'
import { DeviceSaveBanner } from '@/components/photo/DeviceSaveBanner'
import { Button } from '@/components/ui/button'
import { PHASE_OPTIONS, type Phase } from '@/types/photo'
import type { Photo } from '@/types/photo'
import { resolvePhotoThumbUrl } from '@/lib/cloudSync'
import { cn } from '@/lib/utils'

const OPACITY_STORAGE_KEY = 'genba-overlay-capture-opacity'
const DISPLAY_MODE_KEY = 'genba-overlay-display-mode'
const DEFAULT_OPACITY = 0.5
const MIN_SCALE = 0.3
const MAX_SCALE = 4
const ZOOM_STEP = 0.1

type DisplayMode = 'overlay' | 'miniature'

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

function loadStoredDisplayMode(): DisplayMode {
  return localStorage.getItem(DISPLAY_MODE_KEY) === 'miniature' ? 'miniature' : 'overlay'
}

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
}

function pointerDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function defaultSavePhase(basePhase: Phase | null): Phase | null {
  if (basePhase === 'during') return 'during'
  return 'after'
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
  const deviceSave = useDeviceSave()

  const [overlayUrl, setOverlayUrl] = useState<string | null>(null)
  const [showOverlay, setShowOverlay] = useState(true)
  const [opacity, setOpacity] = useState(loadStoredOpacity)
  const [displayMode, setDisplayMode] = useState<DisplayMode>(loadStoredDisplayMode)
  const [transform, setTransform] = useState<Transform>(DEFAULT_TRANSFORM)
  const [isSaving, setIsSaving] = useState(false)
  const [justCaptured, setJustCaptured] = useState(false)
  const [captureCount, setCaptureCount] = useState(0)
  const [savePhase, setSavePhase] = useState<Phase | null>(() => defaultSavePhase(beforePhoto.phase))

  // 小窓のドラッグ位置
  const [miniOffset, setMiniOffset] = useState({ x: 0, y: 0 })
  const miniDrag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null)

  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<{
    mode: 'pan' | 'pinch' | 'none'
    base: Transform
    start: { x: number; y: number }
    startDist: number
  }>({ mode: 'none', base: DEFAULT_TRANSFORM, start: { x: 0, y: 0 }, startDist: 0 })

  // 施工前写真の読み込み
  useEffect(() => {
    let revoke: string | null = null
    photoStorage.getObjectURL(beforePhoto.id).then((url) => {
      if (url) {
        revoke = url
        setOverlayUrl(url)
      } else {
        setOverlayUrl(resolvePhotoThumbUrl(beforePhoto))
      }
    })
    return () => { if (revoke) URL.revokeObjectURL(revoke) }
  }, [beforePhoto.id, beforePhoto.thumbnail_data_url, beforePhoto.storage_path])

  useEffect(() => {
    localStorage.setItem(OPACITY_STORAGE_KEY, String(opacity))
  }, [opacity])

  useEffect(() => {
    localStorage.setItem(DISPLAY_MODE_KEY, displayMode)
  }, [displayMode])

  useEffect(() => {
    if (!justCaptured) return
    const t = setTimeout(() => setJustCaptured(false), 1500)
    return () => clearTimeout(t)
  }, [justCaptured])

  // ── オーバーレイのパン / ピンチ ──────────────────────────
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

  // ── 小窓のドラッグ ────────────────────────────────────
  const handleMiniPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    miniDrag.current = { startX: e.clientX, startY: e.clientY, baseX: miniOffset.x, baseY: miniOffset.y }
  }

  const handleMiniPointerMove = (e: React.PointerEvent) => {
    if (!miniDrag.current) return
    setMiniOffset({
      x: miniDrag.current.baseX + (e.clientX - miniDrag.current.startX),
      y: miniDrag.current.baseY + (e.clientY - miniDrag.current.startY),
    })
  }

  const handleMiniPointerUp = () => { miniDrag.current = null }

  const handleZoom = (delta: number) => setTransform((t) => ({ ...t, scale: clampScale(t.scale + delta) }))
  const handleReset = () => setTransform(DEFAULT_TRANSFORM)

  const toggleDisplayMode = () => {
    setDisplayMode((m) => (m === 'overlay' ? 'miniature' : 'overlay'))
    setTransform(DEFAULT_TRANSFORM)
  }

  // ── 撮影 ────────────────────────────────────────────
  const handleCapture = async () => {
    const video = videoRef.current
    if (!video || status !== 'ready' || isSaving) return
    setIsSaving(true)
    try {
      const blob = await captureVideoFrame(video)
      const file = blobToFile(blob, `photo_${Date.now()}.jpg`)
      await uploadPhotos([file], savePhase, () => {})
      setCaptureCount((c) => c + 1)
      setJustCaptured(true)
      deviceSave.queueFiles([file])
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
          基準写真を変更
        </Button>

        <div className="flex items-center gap-2">
          {captureCount > 0 && (
            <span className="text-white/70 text-xs">{captureCount}枚撮影済み</span>
          )}
          <button
            onClick={toggleDisplayMode}
            className="h-8 w-8 rounded-full bg-white/10 text-white flex items-center justify-center hover:bg-white/20 transition-colors"
            aria-label={displayMode === 'overlay' ? '小窓表示に切替' : '半透明表示に切替'}
            title={displayMode === 'overlay' ? '小窓表示' : '半透明表示'}
          >
            {displayMode === 'overlay' ? (
              <PictureInPicture2 className="h-4 w-4" />
            ) : (
              <Layers className="h-4 w-4" />
            )}
          </button>
          <Button variant="secondary" size="sm" onClick={onClose}>
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

        {/* 半透明オーバーレイモード */}
        {status === 'ready' && overlayUrl && displayMode === 'overlay' && (
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

        {/* 小窓モード */}
        {status === 'ready' && overlayUrl && displayMode === 'miniature' && (
          <div
            className="absolute touch-none select-none cursor-grab active:cursor-grabbing"
            style={{
              top: `${12 + miniOffset.y}px`,
              right: `${12 - miniOffset.x}px`,
              width: '28%',
              maxWidth: '160px',
              minWidth: '80px',
              zIndex: 20,
            }}
            onPointerDown={handleMiniPointerDown}
            onPointerMove={handleMiniPointerMove}
            onPointerUp={handleMiniPointerUp}
            onPointerCancel={handleMiniPointerUp}
          >
            <div className="relative rounded-lg overflow-hidden shadow-[0_0_0_2px_rgba(255,255,255,0.6)] bg-black">
              <img
                src={overlayUrl}
                alt="施工前写真（小窓）"
                draggable={false}
                className="w-full h-auto block pointer-events-none"
                style={{ opacity: showOverlay ? 1 : 0.25 }}
              />
              <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] text-center py-0.5 pointer-events-none">
                施工前
              </div>
            </div>
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
        {/* 保存先フェーズ */}
        <div className="flex items-center gap-2">
          <span className="text-white/60 text-xs shrink-0">保存先</span>
          <div className="flex gap-1.5 flex-1">
            {PHASE_OPTIONS.map(({ value, label }) => (
              <button
                key={label}
                onClick={() => setSavePhase(value)}
                className={cn(
                  'flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors active:scale-95',
                  value === savePhase ? 'bg-white text-neutral-900' : 'bg-white/10 text-white hover:bg-white/20',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 透明度スライダー（半透明モード） */}
        {displayMode === 'overlay' && (
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
        )}

        {/* 小窓モードのトグル */}
        {displayMode === 'miniature' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowOverlay((v) => !v)}
              className="text-white/80 hover:text-white transition-colors shrink-0"
              aria-label={showOverlay ? '小窓を隠す' : '小窓を表示'}
              aria-pressed={showOverlay}
            >
              {showOverlay ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
            </button>
            <span className="text-white/60 text-xs">小窓表示中（ドラッグで移動）</span>
          </div>
        )}

        {/* 拡大縮小 + シャッター */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          <div className="flex items-center gap-1.5 justify-self-start">
            {displayMode === 'overlay' && (
              <>
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
              </>
            )}
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

      {/* スマホに保存バナー（画面下部 fixed） */}
      <DeviceSaveBanner
        saveMode={deviceSave.saveMode}
        dirHandle={deviceSave.dirHandle}
        pendingFiles={deviceSave.pendingFiles}
        savePhase={deviceSave.savePhase}
        onSaveToDir={deviceSave.handleSaveToDir}
        onPickFolderAndSave={deviceSave.handlePickFolderAndSave}
        onChangeFolder={deviceSave.handleChangeFolder}
        onFallbackSave={deviceSave.handleFallbackSave}
        onDismiss={deviceSave.dismiss}
        positionClass="bottom-6"
      />
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
