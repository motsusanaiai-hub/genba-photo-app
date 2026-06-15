import { useState, useCallback } from 'react'
import type { Photo } from '@/types/photo'

export function usePhotoSelection() {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchorId, setAnchorId] = useState<string | null>(null)

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    setAnchorId(id)
  }, [])

  // Shift+クリック: 直前の基準（anchor）から対象までを範囲選択（既存の選択は置き換える）
  // 基準が無い/見つからない場合は通常のトグルにフォールバック
  const selectRange = useCallback((photos: Photo[], id: string) => {
    const ids = photos.map((p) => p.id)
    const anchorIdx = anchorId ? ids.indexOf(anchorId) : -1
    const targetIdx = ids.indexOf(id)
    if (anchorIdx === -1 || targetIdx === -1) {
      toggle(id)
      return
    }
    const [start, end] = anchorIdx < targetIdx ? [anchorIdx, targetIdx] : [targetIdx, anchorIdx]
    setSelected(new Set(ids.slice(start, end + 1)))
  }, [anchorId, toggle])

  const selectAll = useCallback((ids: string[]) => {
    setSelected(new Set(ids))
  }, [])

  const clear = useCallback(() => {
    setSelected(new Set())
    setAnchorId(null)
  }, [])

  const isSelected = useCallback(
    (id: string) => selected.has(id),
    [selected],
  )

  return { selected, toggle, selectRange, selectAll, clear, isSelected }
}
