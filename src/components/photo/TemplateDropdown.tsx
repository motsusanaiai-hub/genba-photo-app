import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Bookmark, Clock, Plus, X } from 'lucide-react'
import { useTemplateStore } from '@/store/templateStore'
import { SYSTEM_TEMPLATES } from '@/lib/commentTemplates'
import type { Phase } from '@/types/photo'
import { cn } from '@/lib/utils'

const PHASE_LABEL: Record<Phase, string> = {
  before: '施工前',
  during: '施工中',
  after: '施工後',
}

interface Props {
  currentText: string
  phase: Phase | null
  prevComment?: string
  onSelect: (text: string) => void
}

export function TemplateDropdown({ currentText, phase, prevComment, onSelect }: Props) {
  const [open, setOpen] = useState(false)
  const {
    recentComments,
    customTemplates,
    addCustomTemplate,
    removeCustomTemplate,
    addRecentComment,
  } = useTemplateStore()

  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 外部クリックで閉じる
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (
        btnRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      )
        return
      setOpen(false)
    }
    window.addEventListener('mousedown', handler)
    return () => window.removeEventListener('mousedown', handler)
  }, [open])

  // Escape で閉じる
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open])

  const handleSelect = (text: string) => {
    addRecentComment(text)
    onSelect(text)
    setOpen(false)
  }

  const handleSaveTemplate = () => {
    const trimmed = currentText.trim()
    if (!trimmed) return
    if (customTemplates.some((t) => t.text === trimmed)) return  // 重複スキップ
    addCustomTemplate(trimmed)
    setOpen(false)
  }

  const recentToShow = recentComments.slice(0, 5)
  const systemTemplates = phase
    ? SYSTEM_TEMPLATES[phase]
    : Object.values(SYSTEM_TEMPLATES).flat()
  const systemSectionTitle = phase ? `${PHASE_LABEL[phase]}テンプレート` : 'システムテンプレート'

  const showCopyPrev = Boolean(prevComment?.trim())
  const showSave =
    Boolean(currentText.trim()) &&
    !customTemplates.some((t) => t.text === currentText.trim())
  const hasFooter = showCopyPrev || showSave

  return (
    <div className="relative">
      {/* テンプレートボタン */}
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'h-8 w-8 rounded border text-xs font-bold shrink-0',
          'flex items-center justify-center transition-colors',
          open
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-input bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground',
        )}
        aria-label="コメントテンプレートを選ぶ"
        aria-expanded={open}
      >
        テ
      </button>

      {/* ドロップダウンパネル（上向きに展開） */}
      {open && (
        <div
          ref={panelRef}
          className="absolute right-0 z-[100] w-72 bg-background border rounded-xl shadow-xl overflow-hidden"
          style={{ bottom: 'calc(100% + 6px)' }}
        >
          {/* スクロール可能なコンテンツ */}
          <div className="max-h-[55vh] overflow-y-auto">
            {/* ① 最近使ったコメント */}
            {recentToShow.length > 0 && (
              <section>
                <SectionHeader icon={<Clock className="h-3 w-3" />} label="最近使ったコメント" />
                {recentToShow.map((text) => (
                  <ItemButton key={text} text={text} onClick={() => handleSelect(text)} />
                ))}
              </section>
            )}

            {/* ② カスタムテンプレート */}
            {customTemplates.length > 0 && (
              <section className="border-t">
                <SectionHeader icon={<Bookmark className="h-3 w-3" />} label="マイテンプレート" />
                {customTemplates.map((t) => (
                  <div key={t.id} className="flex items-center border-b border-border/40 last:border-b-0">
                    <button
                      type="button"
                      onClick={() => handleSelect(t.text)}
                      className="flex-1 text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors truncate"
                    >
                      {t.text}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCustomTemplate(t.id)}
                      className="px-2.5 py-2.5 text-muted-foreground hover:text-destructive transition-colors shrink-0"
                      aria-label={`「${t.text}」を削除`}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </section>
            )}

            {/* ③ システムテンプレート */}
            <section className={customTemplates.length > 0 || recentToShow.length > 0 ? 'border-t' : ''}>
              <SectionHeader label={systemSectionTitle} />
              {systemTemplates.map((text) => (
                <ItemButton key={text} text={text} onClick={() => handleSelect(text)} />
              ))}
            </section>
          </div>

          {/* フッター：上の写真と同じ / テンプレートに保存 */}
          {hasFooter && (
            <div className="border-t">
              {showCopyPrev && (
                <button
                  type="button"
                  onClick={() => handleSelect(prevComment!)}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors text-muted-foreground flex items-center gap-2 border-b border-border/40"
                >
                  <ArrowUp className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">上の写真と同じ「{prevComment}」</span>
                </button>
              )}
              {showSave && (
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors text-muted-foreground flex items-center gap-2"
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" />
                  テンプレートに保存
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function SectionHeader({ icon, label }: { icon?: React.ReactNode; label: string }) {
  return (
    <div className="px-3 py-1.5 bg-muted/50 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      {icon}
      {label}
    </div>
  )
}

function ItemButton({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 text-sm hover:bg-muted transition-colors border-b border-border/40 last:border-b-0"
    >
      {text}
    </button>
  )
}
