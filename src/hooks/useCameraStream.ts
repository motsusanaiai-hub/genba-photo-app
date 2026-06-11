import { useCallback, useEffect, useRef, useState } from 'react'

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error'
export type CameraErrorReason = 'permission' | 'not-found' | 'unsupported' | 'unknown'

const CONSTRAINTS: MediaStreamConstraints[] = [
  { video: { facingMode: { ideal: 'environment' } }, audio: false },
  { video: true, audio: false },
]

/**
 * 背面カメラの映像ストリームを <video> へ接続するフック。
 * アンマウント時に必ずトラックを停止する。
 */
export function useCameraStream() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus>('idle')
  const [error, setError] = useState<CameraErrorReason | null>(null)

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error')
      setError('unsupported')
      return
    }

    setStatus('requesting')
    setError(null)
    stop()

    let lastError: unknown = null
    for (const constraints of CONSTRAINTS) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {})
        }
        setStatus('ready')
        return
      } catch (e) {
        lastError = e
      }
    }

    const name = (lastError as DOMException)?.name
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') setError('permission')
    else if (name === 'NotFoundError' || name === 'OverconstrainedError') setError('not-found')
    else setError('unknown')
    setStatus('error')
  }, [stop])

  useEffect(() => {
    start()
    return () => stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { videoRef, status, error, retry: start }
}
