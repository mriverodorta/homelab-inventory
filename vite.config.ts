import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
      '@homelab-inventory/share-contract': path.resolve(import.meta.dirname, './packages/share-contract/src/index.ts'),
      '@homelab-inventory/viewer-model': path.resolve(import.meta.dirname, './packages/viewer-model/src/index.ts'),
      '@homelab-inventory/viewer-react': path.resolve(import.meta.dirname, './packages/viewer-react/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
