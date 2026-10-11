import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExcelExportGroup, ExcelExportSettingsPanel } from '@/components/project/ExcelExportGroup'
import { PROJECT, makePhotoSet } from './excelTestUtils'

// Excel出力ボタンの整理（6ボタン → 標準台帳・大写真台帳・施工前後比較の3ボタン＋出力方式の設定）。

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')
const photos = makePhotoSet()
const noop = () => {}

describe('Excel出力ボタン', () => {
  it('標準台帳・大写真台帳・施工前後比較の3つと、出力方式の設定（歯車）を表示する', () => {
    const html = renderToStaticMarkup(createElement(ExcelExportGroup, { project: PROJECT, photos, hasBeforeAfter: true }))
    for (const label of ['標準台帳', '大写真台帳', '施工前後比較']) expect(html).toContain(`>${label}<`)
    expect(html).toContain('aria-label="Excel出力方式の設定"')
    expect(html.match(/aria-label="[^"]*をExcel出力（/g)).toHaveLength(3)
    // 旧ボタン（通常出力と高互換出力が別々のボタン）は無い
    expect(html).not.toContain('標準（2×3）')
    expect(html).not.toContain('Excel高互換出力')
  })

  it('施工前・施工後の写真がそろっていない場合、施工前後比較は表示しない（従来と同じ条件）', () => {
    const html = renderToStaticMarkup(createElement(ExcelExportGroup, { project: PROJECT, photos, hasBeforeAfter: false }))
    expect(html).toContain('>標準台帳<')
    expect(html).toContain('>大写真台帳<')
    expect(html).not.toContain('施工前後比較')
  })

  it('初期設定は標準モード（Windows 以外・設定未保存の環境）', () => {
    const html = renderToStaticMarkup(createElement(ExcelExportGroup, { project: PROJECT, photos, hasBeforeAfter: true }))
    expect(html).toContain('標準台帳をExcel出力（標準モード）')
    expect(html).not.toContain('Excel直接作成モード）')
  })
})

describe('出力方式の設定パネル', () => {
  it('Windows では2つの方式を選べ、Helper の有無はブラウザから確認できない旨と切り替え方法を案内する', () => {
    const html = renderToStaticMarkup(
      createElement(ExcelExportSettingsPanel, { savedMode: 'standard', windows: true, onChange: noop, onClose: noop }),
    )
    expect(html).toContain('標準モード')
    expect(html).toContain('スマホ・PCで利用できます。')
    expect(html).toContain('Excel直接作成モード')
    expect(html).toContain('Windows版Excelと専用Helperが必要です。')
    expect(html).toContain('ブラウザからは確認できません')
    expect(html).toContain('標準モードに切り替えてください')
    expect(html).not.toMatch(/<button[^>]*disabled[^>]*role="radio"|role="radio"[^>]*disabled/)
  })

  it('Windows 以外では Excel直接作成モードを選べず、理由を表示する', () => {
    const html = renderToStaticMarkup(
      createElement(ExcelExportSettingsPanel, { savedMode: 'standard', windows: false, onChange: noop, onClose: noop }),
    )
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(2)
    expect(radios[0]).not.toContain('disabled')
    expect(radios[1]).toContain('disabled')
    expect(html).toContain('Windowsではないため、Excel直接作成モードは利用できません')
  })

  it('Windows 以外の端末に Excel直接作成モードが保存されていても、選択状態は標準モードになる', () => {
    const html = renderToStaticMarkup(
      createElement(ExcelExportSettingsPanel, { savedMode: 'direct', windows: false, onChange: noop, onClose: noop }),
    )
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
    expect(radios[0]).toContain('aria-checked="true"')
    expect(radios[1]).toContain('aria-checked="false"')
  })
})

describe('既存処理との関係（静的確認）', () => {
  const button = read('src/components/project/ExcelExportButton.tsx')
  const page = read('src/pages/project/ProjectDetailPage.tsx')

  it('どちらの出力方式も useExcelPageExport（無料版・広告削除版は1回1ページ、Proは全ページ）を通る', () => {
    expect(button.match(/useExcelPageExport</g)).toHaveLength(1)
    const generate = button.slice(button.indexOf('useExcelPageExport<T>('))
    expect(generate).toMatch(/mode === 'standard'[\s\S]*config\.generateStandard\(project, photos, page\)/)
    expect(generate).toMatch(/generateGenbafotoJob\(project, targetPhotos, config\.templateType\)/)
  })

  it('標準モードは既存の ExcelJS 生成関数、Excel直接作成モードは既存の .genbafoto 生成処理をそのまま使う', () => {
    for (const fn of ['generateExcel(', 'generateOneColumnExcel(', 'generateBeforeAfterExcel(']) expect(button).toContain(fn)
    for (const fn of ['listStandardExcelPages(', 'listOneColumnExcelPages(', 'listBeforeAfterExcelPages(']) expect(button).toContain(fn)
    expect(button).toContain("import('@/lib/generateGenbafotoJob')")
    expect(button).toMatch(/templateType: 'standard'[\s\S]*templateType: 'large'[\s\S]*templateType: 'beforeAfter'/)
  })

  it('工事詳細画面は新しいExcel出力ボタンを使い、写真ZIPボタンは残っている', () => {
    expect(page).toContain('<ExcelExportGroup')
    expect(page).toContain('<ZipExportButton')
    expect(page).not.toMatch(/\b(ExportButton|LargePhotoExportButton|BeforeAfterExportButton|GenbafotoExportButton)\b/)
  })
})
