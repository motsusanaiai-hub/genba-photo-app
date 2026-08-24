import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  open: boolean
  title: string
  submitLabel: string
  initialName?: string
  onClose: () => void
  onSubmit: (name: string) => void
}

/** フォルダの新規作成・名前変更で共用する簡易入力モーダル */
export function FolderFormModal({ open, title, submitLabel, initialName = '', onClose, onSubmit }: Props) {
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  if (!open) return null

  const trimmed = name.trim()

  const handleSubmit = () => {
    if (!trimmed) return
    onSubmit(trimmed)
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background w-full max-w-sm rounded-t-2xl lg:rounded-2xl shadow-xl">
        <div className="flex items-center justify-between px-4 py-4 border-b">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-muted transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: 6階トイレ"
            autoFocus
            className="w-full text-sm rounded-md border bg-background border-input px-3 py-2.5 focus:outline-none focus:ring-1 focus:ring-ring"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit()
            }}
          />
        </div>

        <div className="px-4 py-4 border-t flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            キャンセル
          </Button>
          <Button className="flex-1" onClick={handleSubmit} disabled={!trimmed}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
