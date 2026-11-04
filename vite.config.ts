import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { vitestWorkerBudget } from './scripts/ci/test-worker-budget.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
    rollupOptions: {
      output: {
        codeSplitting: {
          groups: [
            // Reserve eager dependencies before grouping controls used by lazy routes.
            { name: 'initial-runtime', tags: ['$initial'], priority: 30 },
            { name: 'lucide-icons', test: /\/node_modules\/lucide-react\//, priority: 20 },
            {
              name: 'radix-controls',
              test: /\/node_modules\/@radix-ui\/react-(alert-dialog|dialog|dropdown-menu|menu|scroll-area|select|tooltip)\//,
              priority: 10,
            },
          ],
        },
      },
    },
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
    maxWorkers: vitestWorkerBudget(),
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
