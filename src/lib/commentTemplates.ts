import type { Phase } from '@/types/photo'

export const SYSTEM_TEMPLATES: Record<Phase, string[]> = {
  before: [
    '全景（施工前）',
    '補修範囲確認',
    '既存状態確認',
    'ひび割れ状況',
    '劣化状況確認',
    '墨出し確認',
  ],
  during: [
    '下地処理完了',
    '清掃完了',
    'プライマー塗布完了',
    '材料充填完了',
    '養生状態確認',
    '中間検査',
  ],
  after: [
    '全景（施工後）',
    '仕上がり確認',
    '補修完了',
    '清掃後確認',
    '完成検査',
  ],
}
