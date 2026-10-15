// 利用規約・プライバシーポリシーに「未確定」の項目が残っていないかを確認する、公開前のチェック。
//
//   npm run check:legal
//
// 未確定の項目が1つでも残っていれば、一覧を表示して終了コード 1 で終わる。
// ビルド（npm run build）や自動テストには組み込んでいない：未確定の項目があっても、ビルドとテストは失敗しない。
// 本番に公開する前に、手動で（またはリリース手順の一部として）実行すること。
//
// 本文の未確定の表示は src/components/legal/LegalLayout.tsx の LegalPending（`<LegalPending item="…" />`）で、
// 項目名は src/lib/legalInfo.ts の LEGAL_PENDING_ITEMS にある。

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const legalInfo = readFileSync(path.join(root, 'src/lib/legalInfo.ts'), 'utf8')
const pagesDir = path.join(root, 'src/pages/legal')

// LEGAL_PENDING_ITEMS = { key: 'ラベル', ... } を読む
const block = legalInfo.match(/LEGAL_PENDING_ITEMS = \{([\s\S]*?)\} as const/)?.[1] ?? ''
const labels = Object.fromEntries([...block.matchAll(/^\s*(\w+):\s*'([^']+)'/gm)].map((m) => [m[1], m[2]]))

const found = []
for (const file of readdirSync(pagesDir).filter((f) => f.endsWith('.tsx'))) {
  const source = readFileSync(path.join(pagesDir, file), 'utf8')
  // コメントは除いて数える
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  for (const match of code.matchAll(/<LegalPending\s+item="(\w+)"/g)) {
    found.push({ file, key: match[1], label: labels[match[1]] ?? '(不明な項目)' })
  }
}

if (found.length === 0) {
  console.log('OK: 利用規約・プライバシーポリシーに、未確定の項目は残っていません。')
  process.exit(0)
}

console.log(`未確定の項目が ${found.length} 件残っています。公開前に確定して、本文を差し替えてください：`)
for (const { file, key, label } of found) console.log(`  - ${label}  [${key}]  (${file})`)
process.exit(1)
