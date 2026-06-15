import type { Workbook } from 'exceljs'
import type { Photo } from '@/types/photo'
import type { Project } from '@/types/project'
import { buildExcelWorkbook } from '@/lib/generateExcel'
import { buildOneColumnWorkbook } from '@/lib/generateOneColumnExcel'
import { buildBeforeAfterWorkbook } from '@/lib/generateBeforeAfterExcel'

export type ExcelTemplateId = 'standard' | 'large' | 'beforeAfter'

interface ExcelTemplate {
  label: string    // テンプレート選択UIで表示するラベル
  filename: string // ZIP内に格納するExcelファイル名
  buildWorkbook: (project: Project, photos: Photo[]) => Promise<Workbook>
}

export const EXCEL_TEMPLATES: Record<ExcelTemplateId, ExcelTemplate> = {
  standard: {
    label: '標準（2×3）',
    filename: '工事写真台帳.xlsx',
    buildWorkbook: buildExcelWorkbook,
  },
  large: {
    label: '大写真（1×3）',
    filename: '工事写真台帳(大判).xlsx',
    buildWorkbook: buildOneColumnWorkbook,
  },
  beforeAfter: {
    label: '前後比較',
    filename: '施工前後写真台帳.xlsx',
    buildWorkbook: buildBeforeAfterWorkbook,
  },
}
