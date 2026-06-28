import { Check, Download, Folder, FolderOpen } from 'lucide-react'
import type { SaveMode } from '@/utils/deviceFileSave'
import type { DeviceSavePhase } from '@/hooks/useDeviceSave'

interface Props {
  saveMode: SaveMode
  dirHandle: FileSystemDirectoryHandle | null
  pendingFiles: File[]
  savePhase: DeviceSavePhase
  onSaveToDir: () => void
  onPickFolderAndSave: () => void
  onChangeFolder: () => void
  onFallbackSave: () => void
  onDismiss: () => void
  /** fixed 配置の bottom 位置クラス（デフォルト: 'bottom-6'） */
  positionClass?: string
}

export function DeviceSaveBanner({
  saveMode,
  dirHandle,
  pendingFiles,
  savePhase,
  onSaveToDir,
  onPickFolderAndSave,
  onChangeFolder,
  onFallbackSave,
  onDismiss,
  positionClass = 'bottom-6',
}: Props) {
  const count = pendingFiles.length
  const fileLabel = count > 1 ? `${count}枚を` : ''

  const fixedBase = `fixed ${positionClass} left-1/2 -translate-x-1/2 z-[90]`

  // ── 保存完了 ──────────────────────────────────────────
  if (savePhase === 'saved') {
    return (
      <div className={`${fixedBase} flex items-center gap-2 bg-neutral-900 border border-white/20 text-white px-5 py-3 rounded-full shadow-xl pointer-events-none`}>
        <Check className="h-4 w-4 text-green-400 shrink-0" />
        <span className="text-sm font-medium">スマホに保存しました</span>
      </div>
    )
  }

  // ── 保存中 ────────────────────────────────────────────
  if (savePhase === 'saving') {
    return (
      <div className={`${fixedBase} flex items-center gap-2 bg-neutral-900 border border-white/20 text-white px-5 py-3 rounded-full shadow-xl pointer-events-none`}>
        <span className="h-4 w-4 rounded-full border-2 border-white/30 border-t-white animate-spin shrink-0" />
        <span className="text-sm">保存中...</span>
      </div>
    )
  }

  // ── ファイルなし ──────────────────────────────────────
  if (pendingFiles.length === 0) return null

  // ── fs-access 非対応のフォールバック ──────────────────
  if (saveMode !== 'fs-access') {
    return (
      <div className={`${fixedBase} bg-neutral-900 border border-white/20 text-white rounded-2xl shadow-xl px-3 py-2.5 w-[min(92vw,380px)]`}>
        <div className="flex items-center gap-2">
          <Download className="h-4 w-4 text-white/70 shrink-0" />
          <span className="text-sm flex-1 leading-tight">{fileLabel}スマホに保存しますか？</span>
          <button
            onClick={onFallbackSave}
            className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-white/90 active:scale-95 transition-all whitespace-nowrap shrink-0"
          >
            保存
          </button>
          <CloseButton onClick={onDismiss} />
        </div>
        {savePhase === 'error' && <ErrorText />}
      </div>
    )
  }

  // ── fs-access 対応：フォルダ未設定（初回案内） ──────────
  if (!dirHandle) {
    return (
      <div className={`${fixedBase} bg-neutral-900 border border-white/20 text-white rounded-2xl shadow-xl px-4 py-3.5 w-[min(92vw,380px)] space-y-3`}>
        {/* ヘッダー */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Folder className="h-4 w-4 text-amber-400 shrink-0" />
            <p className="text-sm font-medium leading-tight">{fileLabel}スマホに保存</p>
          </div>
          <CloseButton onClick={onDismiss} />
        </div>

        {/* 案内テキスト */}
        <div className="bg-white/5 rounded-xl px-3 py-2.5 space-y-1.5">
          <p className="text-xs text-white/85 leading-relaxed">
            保存先フォルダを設定してください。<br />
            おすすめは「<strong className="text-white">Camera</strong>」または「<strong className="text-white">Pictures</strong>」です。<br />
            迷った場合は「<strong className="text-white">Camera</strong>」を選んでください。
          </p>
          <p className="text-[11px] text-white/45 leading-relaxed">
            保存後の写真は、写真アプリまたはファイルアプリから確認できます。
          </p>
        </div>

        {/* 設定ボタン */}
        <button
          onClick={onPickFolderAndSave}
          className="w-full py-2.5 bg-white text-black rounded-xl text-sm font-semibold hover:bg-white/90 active:scale-95 transition-all"
        >
          保存先を設定
        </button>

        {savePhase === 'error' && <ErrorText />}
      </div>
    )
  }

  // ── fs-access 対応：フォルダ設定済み（1タップ保存） ────
  return (
    <div className={`${fixedBase} bg-neutral-900 border border-white/20 text-white rounded-2xl shadow-xl px-3 py-2.5 w-[min(92vw,380px)]`}>
      <div className="flex items-center gap-2">
        <FolderOpen className="h-4 w-4 text-green-400 shrink-0" />
        <div className="flex-1 min-w-0">
          <span className="text-sm">{fileLabel}スマホに保存</span>
          <span className="text-xs text-white/45 ml-1.5">保存先：{dirHandle.name}</span>
        </div>
        <button
          onClick={onSaveToDir}
          className="px-3 py-1.5 bg-white text-black rounded-lg text-xs font-semibold hover:bg-white/90 active:scale-95 transition-all whitespace-nowrap shrink-0"
        >
          保存
        </button>
        <CloseButton onClick={onDismiss} />
      </div>
      <div className="mt-1 text-right pr-1">
        <button
          onClick={onChangeFolder}
          className="text-[11px] text-white/40 hover:text-white/70 transition-colors underline"
        >
          保存先を変更
        </button>
      </div>
      {savePhase === 'error' && <ErrorText />}
    </div>
  )
}

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-8 h-8 flex items-center justify-center text-white/40 hover:text-white transition-colors text-xl leading-none shrink-0"
      aria-label="閉じる"
    >
      ×
    </button>
  )
}

function ErrorText() {
  return (
    <p className="text-xs text-red-400 mt-1.5 text-center">
      保存に失敗しました。再度お試しください。
    </p>
  )
}
