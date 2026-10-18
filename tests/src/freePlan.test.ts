import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as plan from '@/lib/plan'

// 完全無料化：一般ユーザー向け画面から、料金・購入・アップグレード・制限の案内が無くなっていること。
// 画面そのものの描画ではなく、ソースを静的に確認する（広告の描画は adSlot.test.ts）。

const ROOT = path.resolve(__dirname, '../..')
const read = (file: string) => readFileSync(path.join(ROOT, file), 'utf8')

// 画面に出る文言だけを確認するため、コメント（/* */ と行頭・空白の後の //）を除いたソースを返す。
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
const readCode = (file: string) => stripComments(read(file))

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name)
    return statSync(full).isDirectory() ? sourceFiles(full) : /\.(ts|tsx)$/.test(name) ? [full] : []
  })
}
const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join('/')

// 決済完了画面（過去のテスト決済・既存URL向け）と、将来の再利用のために残した購入関連コンポーネント。
// 利用規約・プライバシーポリシー（src/pages/legal）は、「有料プランの新規販売を終了した」ことを説明するため、
// 料金に関する語を含んでよい（内容は legal.test.ts で確認する）。
const BILLING_FILES = [
  'src/components/billing/RemoveAdsButton.tsx',
  'src/components/billing/ProCheckoutButton.tsx',
  'src/components/billing/ManageSubscriptionCard.tsx',
  'src/pages/billing/CheckoutSuccessPage.tsx',
  'src/pages/billing/ProCheckoutSuccessPage.tsx',
]

describe('ダッシュボード', () => {
  const source = readCode('src/pages/DashboardPage.tsx')

  it('購入ボタン・契約管理・工事案件数の制限案内を表示しない', () => {
    expect(source).not.toMatch(/RemoveAdsButton|ProCheckoutButton/)
    expect(source).not.toMatch(/PROJECT_LIMIT_MESSAGE|showLimitNotice|canCreateNewProject/)
    expect(source).not.toMatch(/300円|広告を削除|Proプラン|アップグレード/)
  })

  it('広告（AdSlot）をダッシュボードに表示している', () => {
    expect(source).toMatch(/<AdSlot\b/)
  })

  it('既存の月額契約者向けの契約管理（ManageSubscriptionCard）を表示している', () => {
    expect(source).toMatch(/<ManageSubscriptionCard\b/)
  })

  it('広告の下の案内（フッター）に、モバイルのFABと重ならない下余白を付けている', () => {
    expect(source).toMatch(/<AdSlot\b/)
    expect(source).toMatch(/<footer className="[^"]*mb-24[^"]*lg:mb-6[^"]*"/)
  })

  it('新規作成ボタン・FABは工事案件数に関係なく新規作成画面へ遷移する', () => {
    expect(source).toMatch(/const handleNewProjectClick = \(\) => \{\s*navigate\('\/projects\/new'\)\s*\}/)
  })
})

describe('新規工事の登録画面', () => {
  const source = readCode('src/pages/project/ProjectNewPage.tsx')

  it('工事案件数の上限による表示の切り替え・案内がない', () => {
    expect(source).not.toMatch(/PROJECT_LIMIT_MESSAGE|canCreateNewProject|limitError|上限/)
    expect(source).toMatch(/<ProjectForm\b/)
  })
})

describe('プラン判定の案内文', () => {
  it('lib/plan に、上限・1ページ制限・アップグレードの案内文が残っていない', () => {
    expect(Object.keys(plan).sort()).toEqual(['canCreateProject', 'canExportAllExcelPages', 'projectLimit', 'shouldShowAds'])
  })

  it('Excelページ選択モーダルに、1ページ制限の案内を表示しない（モーダル自体は残す）', () => {
    const source = readCode('src/components/project/ExcelPageSelectModal.tsx')
    expect(source).not.toMatch(/EXCEL_PAGE_LIMIT_MESSAGE|1ページのみ|Proプラン/)
    expect(source).toContain('export function ExcelPageSelectModal')
  })
})

describe('一般ユーザー向け画面に料金・購入の表示がない', () => {
  const generalFiles = sourceFiles(path.join(ROOT, 'src')).filter(
    (file) => !BILLING_FILES.includes(rel(file)) && !rel(file).startsWith('src/pages/legal/'),
  )

  it('料金・購入・アップグレードの文言が、購入関連ファイル以外に無い', () => {
    const found = generalFiles.filter((file) =>
      /300円|広告を削除|Proプラン|月額|アップグレード|有料プラン|購入|無料プランでは|現在のプランでは/.test(stripComments(readFileSync(file, 'utf8'))),
    )
    expect(found.map(rel)).toEqual([])
  })

  it('購入ボタンは、どの画面からも使われていない（契約管理は既存契約者向けにダッシュボードだけが使う）', () => {
    const importers = (name: string) =>
      generalFiles
        .filter((file) => new RegExp(`components/billing/${name}`).test(readFileSync(file, 'utf8')))
        .map(rel)
    expect(importers('(RemoveAdsButton|ProCheckoutButton)')).toEqual([])
    expect(importers('ManageSubscriptionCard')).toEqual(['src/pages/DashboardPage.tsx'])
  })

  it('決済完了画面のルートは、既存URLへの対応として残している', () => {
    const router = read('src/router.tsx')
    expect(router).toContain("path: 'billing/success'")
    expect(router).toContain("path: 'billing/pro/success'")
  })

  it('決済完了画面は、上限が外れるといった、現在の仕様と異なる説明をしない', () => {
    for (const file of [
      'src/pages/billing/CheckoutSuccessPage.tsx',
      'src/pages/billing/ProCheckoutSuccessPage.tsx',
    ]) {
      const source = readCode(file)
      expect(source).not.toMatch(/以降、広告は表示されません|無制限に登録/)
      expect(source).toContain('すべての機能を無料でご利用いただけるようになりました')
    }
  })
})

describe('Excel出力・工事案件の入口が、プランの判定を通っている', () => {
  it('Excel出力は canExportAllExcelPages を通る（全プランで全ページ出力）', () => {
    const source = read('src/hooks/useExcelPageExport.ts')
    expect(source).toMatch(/if \(canExportAllExcelPages\(plan\)\) \{\s*await runGenerate\(project, photos\)/)
    // 将来のためにページ選択の処理は残している
    expect(source).toContain('setPickerPages(pages)')
  })

  it('工事案件の新規作成は canCreateProject を通る（上限なし）', () => {
    const source = read('src/hooks/useProjects.ts')
    expect(source).toContain('canCreateProject(user?.plan')
    expect(source).toMatch(/if \(!canCreateNewProject\) return null/)
  })

  it('写真ZIP出力・3台帳・Excel直接作成の画面コードに、プランの判定が無い', () => {
    for (const file of [
      'src/components/project/ZipExportButton.tsx',
      'src/components/project/ExcelExportButton.tsx',
      'src/components/project/ExcelExportGroup.tsx',
      'src/lib/excelExportMode.ts',
    ]) {
      expect(read(file)).not.toMatch(/\bplan\b|shouldShowAds|canExportAllExcelPages|projectLimit/)
    }
  })
})
