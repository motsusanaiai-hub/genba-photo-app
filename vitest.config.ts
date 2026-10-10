import { defineConfig } from 'vitest/config'
import path from 'path'

// テストは tests/ 配下に置く（api/ 配下に置くと Vercel が Function として扱うため）。
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
