import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { FAKE_JPEG, PROJECT, installFileReaderPolyfill, loginAs, makePhotoSet } from './excelTestUtils'

// Excel写真台帳のファイル名（STEP 6-C）。
//   - 工事名の加工規則：前後の空白除去 → 制御文字と \ / : * ? " < > | を「_」→ 空なら「現場フォト」→ 最大100文字
//   - 「{工事名}_標準台帳.xlsx」「{工事名}_大判台帳.xlsx」「{工事名}_施工前後台帳.xlsx」
//   - Windows Helper 1.1.0（STEP 6-B）と同じ入力で同じ名前になること
//   - Web標準モードの3種類の出力が、実際にこの名前でダウンロードされること

vi.mock('@/lib/photoStorage', () => ({
  photoStorage: { getCompressedBlob: async () => FAKE_JPEG, getObjectURL: async () => null },
}))
vi.mock('@/lib/cloudSync', () => ({ downloadCloudCompressed: async () => null }))

import { excelLedgerFileName, sanitizeProjectNameForFile } from '@/lib/excelFileName'
import { generateExcel } from '@/lib/generateExcel'
import { generateOneColumnExcel } from '@/lib/generateOneColumnExcel'
import { generateBeforeAfterExcel } from '@/lib/generateBeforeAfterExcel'
import type { Project } from '@/types/project'

await loginAs('user-1')

describe('工事名の加工（sanitizeProjectNameForFile）', () => {
  it('禁止文字（\\ / : * ? " < > |）と制御文字を「_」に置き換え、前後の空白を除く', () => {
    // Helper 1.1.0 のテスト（s6b_name_invalid）と同じ入力・同じ期待値
    const name = '  STEP6B 禁止\\/:*?"<>|文字\u0001制御  '
    expect(sanitizeProjectNameForFile(name)).toBe('STEP6B 禁止_________文字_制御')
    expect(sanitizeProjectNameForFile('A\tB\nC')).toBe('A_B_C')
  })

  it('全角スペースも前後の空白として除き、途中の空白は残す', () => {
    expect(sanitizeProjectNameForFile('　 ○○マンション 改修　 ')).toBe('○○マンション 改修')
  })

  it('空白だけ・空文字・null・undefined は「現場フォト」', () => {
    expect(sanitizeProjectNameForFile(' 　  　')).toBe('現場フォト')
    expect(sanitizeProjectNameForFile('')).toBe('現場フォト')
    expect(sanitizeProjectNameForFile(null)).toBe('現場フォト')
    expect(sanitizeProjectNameForFile(undefined)).toBe('現場フォト')
  })

  it('最大100文字に切る（Helper の s6b_name_long と同じ161文字の入力）', () => {
    const name = 'STEP6B長い工事名' + 'あいうえおかきくけこ'.repeat(15)
    expect(name).toHaveLength(161)
    const s = sanitizeProjectNameForFile(name)
    expect(s).toHaveLength(100)
    expect(s).toBe(name.slice(0, 100))
  })

  it('切った位置がサロゲートペアの途中になる場合はその1文字を含めず、切った後の末尾の空白も除く', () => {
    const emoji = '\u{1F3D7}' // 🏗（UTF-16 で2単位）
    expect(sanitizeProjectNameForFile('あ'.repeat(99) + emoji + 'い')).toBe('あ'.repeat(99))
    expect(sanitizeProjectNameForFile('あ'.repeat(99) + ' ' + 'い')).toBe('あ'.repeat(99)) // 100文字目が空白
    expect(sanitizeProjectNameForFile('あ'.repeat(100))).toBe('あ'.repeat(100))
  })
})

describe('台帳のファイル名（excelLedgerFileName）', () => {
  it('標準・大判・施工前後の3種類', () => {
    expect(excelLedgerFileName('テスト工事', 'standard')).toBe('テスト工事_標準台帳.xlsx')
    expect(excelLedgerFileName('テスト工事', 'large')).toBe('テスト工事_大判台帳.xlsx')
    expect(excelLedgerFileName('テスト工事', 'beforeAfter')).toBe('テスト工事_施工前後台帳.xlsx')
  })

  it('Helper 1.1.0 と同じ名前になる（空白だけ → 現場フォト、禁止文字 → _）', () => {
    expect(excelLedgerFileName(' 　  　', 'standard')).toBe('現場フォト_標準台帳.xlsx')
    expect(excelLedgerFileName('', 'large')).toBe('現場フォト_大判台帳.xlsx')
    expect(excelLedgerFileName('A/B', 'beforeAfter')).toBe('A_B_施工前後台帳.xlsx')
  })
})

describe('Web標準モードのダウンロード名', () => {
  const downloaded: string[] = []

  beforeAll(() => {
    installFileReaderPolyfill()
  })

  // triggerBlobDownload は <a download> をクリックしてダウンロードさせる。Node では DOM が無いため、
  // a 要素と URL.createObjectURL だけを差し替えて、付けられたファイル名を記録する（Excel生成は本物）。
  function stubDownload() {
    downloaded.length = 0
    vi.stubGlobal('document', {
      createElement: () => {
        const a = { href: '', download: '', click: () => downloaded.push(a.download) }
        return a
      },
    })
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: () => {} })
  }

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const project = { ...PROJECT, name: '  ○○邸/外壁:改修  ' } as Project

  it('標準台帳・大判台帳・施工前後台帳の名前で、工事名は共通の規則で加工される', async () => {
    stubDownload()
    const photos = makePhotoSet()
    await generateExcel(project, photos)
    await generateOneColumnExcel(project, photos)
    await generateBeforeAfterExcel(project, photos)
    expect(downloaded).toEqual(['○○邸_外壁_改修_標準台帳.xlsx', '○○邸_外壁_改修_大判台帳.xlsx', '○○邸_外壁_改修_施工前後台帳.xlsx'])
  })

  it('選択ページ出力でもページ番号を付けない（全ページ出力と同じ名前）', async () => {
    stubDownload()
    const photos = makePhotoSet()
    const { listStandardExcelPages } = await import('@/lib/generateExcel')
    const pages = listStandardExcelPages(photos)
    expect(pages.length).toBeGreaterThan(1)
    await generateExcel(project, photos, pages[1])
    expect(downloaded).toEqual(['○○邸_外壁_改修_標準台帳.xlsx'])
  })
})
