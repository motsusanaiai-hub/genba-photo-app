import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EXCEL_EXPORT_MODE,
  EXCEL_EXPORT_MODE_STORAGE_KEY,
  isWindowsPlatform,
  loadExcelExportMode,
  resolveExcelExportMode,
  saveExcelExportMode,
} from '@/lib/excelExportMode'

// Excel出力方式（標準モード / Excel直接作成モード）の端末設定。

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial))
  return {
    data,
    getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const UA = {
  windowsChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 Edg/129.0',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
  windowsPhone: 'Mozilla/5.0 (Windows Phone 10.0; Android 6.0.1; Microsoft; Lumia 950) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/52.0 Mobile Safari/537.36 Edge/15.14977',
}

describe('出力方式の保存・読み込み', () => {
  it('初期値は標準モード（未保存・不正な値・読み取りエラー・storage なしのいずれも標準モード）', () => {
    expect(DEFAULT_EXCEL_EXPORT_MODE).toBe('standard')
    expect(loadExcelExportMode(memoryStorage())).toBe('standard')
    expect(loadExcelExportMode(memoryStorage({ [EXCEL_EXPORT_MODE_STORAGE_KEY]: 'helper' }))).toBe('standard')
    expect(loadExcelExportMode(null)).toBe('standard')
    expect(
      loadExcelExportMode({
        getItem: () => {
          throw new Error('SecurityError')
        },
      }),
    ).toBe('standard')
  })

  it('保存した値を読み戻せる', () => {
    const storage = memoryStorage()
    expect(saveExcelExportMode('direct', storage)).toBe(true)
    expect(loadExcelExportMode(storage)).toBe('direct')
    expect(saveExcelExportMode('standard', storage)).toBe(true)
    expect(loadExcelExportMode(storage)).toBe('standard')
  })

  it('専用キーにだけ書き込み、既存の設定キーを上書きしない', () => {
    const existing = {
      'genba-view-mode': 'ledger',
      'genba-grid-size': 'small',
      'genba-phase-visibility': '["before"]',
    }
    const storage = memoryStorage(existing)
    saveExcelExportMode('direct', storage)
    expect(EXCEL_EXPORT_MODE_STORAGE_KEY).toBe('genba-excel-export-mode')
    expect(Object.keys(existing)).not.toContain(EXCEL_EXPORT_MODE_STORAGE_KEY)
    for (const [k, v] of Object.entries(existing)) expect(storage.data.get(k)).toBe(v)
    expect(storage.data.get(EXCEL_EXPORT_MODE_STORAGE_KEY)).toBe('direct')
  })

  it('保存できない環境（プライベートモード等）では false を返し、例外を投げない', () => {
    expect(saveExcelExportMode('direct', null)).toBe(false)
    expect(
      saveExcelExportMode('direct', {
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
      }),
    ).toBe(false)
  })
})

describe('Windows の判定（Excel直接作成モードを選べる環境）', () => {
  it('Windows の Chrome / Edge は true', () => {
    expect(isWindowsPlatform({ userAgent: UA.windowsChrome })).toBe(true)
    expect(isWindowsPlatform({ userAgent: UA.windowsEdge })).toBe(true)
  })

  it('Mac・iPhone・iPad・Android・Linux・Windows Phone は false', () => {
    for (const ua of [UA.mac, UA.iphone, UA.ipad, UA.android, UA.linux, UA.windowsPhone]) {
      expect(isWindowsPlatform({ userAgent: ua })).toBe(false)
    }
  })

  it('userAgentData.platform がある場合はそれを優先する', () => {
    expect(isWindowsPlatform({ userAgent: UA.linux, uaDataPlatform: 'Windows' })).toBe(true)
    expect(isWindowsPlatform({ userAgent: UA.windowsChrome, uaDataPlatform: 'macOS' })).toBe(false)
  })

  it('判定できない環境は false（安全側＝標準モード）', () => {
    expect(isWindowsPlatform(null)).toBe(false)
  })
})

describe('実際に使う出力方式', () => {
  it('Excel直接作成モードは Windows のときだけ有効。それ以外は標準モードで出力する', () => {
    expect(resolveExcelExportMode('direct', true)).toBe('direct')
    expect(resolveExcelExportMode('direct', false)).toBe('standard')
    expect(resolveExcelExportMode('standard', true)).toBe('standard')
    expect(resolveExcelExportMode('standard', false)).toBe('standard')
  })
})
