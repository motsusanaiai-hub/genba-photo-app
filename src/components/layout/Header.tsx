import type { ReactNode } from 'react'

interface HeaderProps {
  title?: string
  left?: ReactNode
  right?: ReactNode
}

export function Header({ title = '現場フォト', left, right }: HeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="flex items-center h-14 px-4 gap-3">
        {left && <div className="flex items-center shrink-0">{left}</div>}
        <h1 className="flex-1 text-base font-semibold truncate">{title}</h1>
        {right && <div className="flex items-center gap-2 shrink-0">{right}</div>}
      </div>
    </header>
  )
}
