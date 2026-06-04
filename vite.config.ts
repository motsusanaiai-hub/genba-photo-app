import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // ExcelJS がブラウザ環境で global を参照するためのポリフィル
  define: {
    global: 'globalThis',
  },
})
