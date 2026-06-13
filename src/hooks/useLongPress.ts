import { useCallback, useRef } from 'react'

const DEFAULT_DELAY_MS = 500
const MOVE_THRESHOLD_PX = 10

interface UseLongPressOptions {
  onLongPress: () => void
  onClick?: () => void
  delayMs?: number
}

/** 長押し（onLongPress）と通常タップ（onClick）を判別するPointer Eventハンドラ群 */
export function useLongPress({ onLongPress, onClick, delayMs = DEFAULT_DELAY_MS }: UseLongPressOptions) {
  const timerRef = useRef<ReturnType<typeof setTimeout>>()
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const firedRef = useRef(false)

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = undefined
  }

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    firedRef.current = false
    startRef.current = { x: e.clientX, y: e.clientY }
    clearTimer()
    timerRef.current = setTimeout(() => {
      firedRef.current = true
      onLongPress()
    }, delayMs)
  }, [onLongPress, delayMs])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!startRef.current) return
    const dx = e.clientX - startRef.current.x
    const dy = e.clientY - startRef.current.y
    if (Math.hypot(dx, dy) > MOVE_THRESHOLD_PX) clearTimer()
  }, [])

  const onPointerEnd = useCallback(() => {
    clearTimer()
  }, [])

  // 長押しが発火した直後のclickは無視する（誤タップ防止）
  const handleClick = useCallback((e: React.MouseEvent) => {
    if (firedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      firedRef.current = false
      return
    }
    onClick?.()
  }, [onClick])

  const onContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerLeave: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onClick: handleClick,
    onContextMenu,
  }
}
