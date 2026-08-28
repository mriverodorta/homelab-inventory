import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  analyzeFrontendBundle,
  DEFAULT_BUNDLE_LIMITS,
} from './check-frontend-bundle.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function fixture({ entrySize = 100, sharedSize = 50, lazySize = 25 } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'homelab-bundle-'))
  temporaryDirectories.push(root)
  mkdirSync(path.join(root, 'assets'))

  const files = {
    'assets/index.js': 'a'.repeat(entrySize),
    'assets/shared.js': 'b'.repeat(sharedSize),
    'assets/inspector.js': 'c'.repeat(lazySize),
    'assets/settings.js': 'd'.repeat(lazySize),
    'assets/inventory-item.js': 'e'.repeat(lazySize),
    'assets/onboarding.js': 'f'.repeat(lazySize),
    'assets/workbench-canvas.js': 'g'.repeat(lazySize),
    'assets/dnd-workspace.js': 'h'.repeat(lazySize),
    'assets/inventory-sidebar.js': 'i'.repeat(lazySize),
    'assets/mobile-inventory.js': 'j'.repeat(lazySize),
    'assets/App.js': 'k'.repeat(lazySize),
  }
  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(path.join(root, file), contents)
  }

  const manifest = {
    'src/main.tsx': {
      file: 'assets/index.js',
      isEntry: true,
      imports: ['_shared.js'],
      dynamicImports: [
        'src/components/inspector-panel.tsx',
        'src/components/settings-dialog.tsx',
        'src/components/inventory-item-dialog.tsx',
        'src/components/onboarding/first-run-dialog.tsx',
        'src/components/workbench-canvas.tsx',
        'src/components/dnd-workspace.tsx',
        'src/components/inventory-sidebar.tsx',
        'src/components/mobile-inventory-sheet.tsx',
        'src/App.tsx',
      ],
    },
    '_shared.js': { file: 'assets/shared.js' },
    'src/components/inspector-panel.tsx': { file: 'assets/inspector.js', isDynamicEntry: true },
    'src/components/settings-dialog.tsx': { file: 'assets/settings.js', isDynamicEntry: true },
    'src/components/inventory-item-dialog.tsx': { file: 'assets/inventory-item.js', isDynamicEntry: true },
    'src/components/onboarding/first-run-dialog.tsx': { file: 'assets/onboarding.js', isDynamicEntry: true },
    'src/components/workbench-canvas.tsx': { file: 'assets/workbench-canvas.js', isDynamicEntry: true },
    'src/components/dnd-workspace.tsx': { file: 'assets/dnd-workspace.js', isDynamicEntry: true },
    'src/components/inventory-sidebar.tsx': { file: 'assets/inventory-sidebar.js', isDynamicEntry: true },
    'src/components/mobile-inventory-sheet.tsx': { file: 'assets/mobile-inventory.js', isDynamicEntry: true },
    'src/App.tsx': { file: 'assets/App.js', isDynamicEntry: true, imports: ['_shared.js'] },
  }

  return { root, manifest }
}

describe('frontend bundle analysis', () => {
  test('counts static imports in the initial bundle and excludes dynamic imports', () => {
    const { root, manifest } = fixture()
    const report = analyzeFrontendBundle({ manifest, assetsRoot: root })

    expect(report.initialBytes).toBe(150)
    expect(report.initial.map((entry) => entry.file)).toEqual([
      'assets/index.js',
      'assets/shared.js',
    ])
    expect(report.asyncChunks).toHaveLength(9)
    expect(report.errors).toEqual([])
    expect(report.routeGraphs.systems.requests).toBe(3)
    expect(report.routeGraphs.canvas.requests).toBe(6)
  })

  test('reports gzip size independently from raw size', () => {
    const { root, manifest } = fixture({ entrySize: 10_000, sharedSize: 10_000 })
    const report = analyzeFrontendBundle({ manifest, assetsRoot: root })

    expect(report.initialBytes).toBe(20_000)
    expect(report.initialGzipBytes).toBeLessThan(report.initialBytes)
  })

  test('fails when a required lazy boundary is missing', () => {
    const { root, manifest } = fixture()
    delete manifest['src/components/settings-dialog.tsx']
    manifest['src/main.tsx'].dynamicImports = manifest['src/main.tsx'].dynamicImports.filter(
      (key) => !key.includes('settings'),
    )

    const report = analyzeFrontendBundle({ manifest, assetsRoot: root })
    expect(report.missingLazyLabels).toEqual(['settings'])
    expect(report.errors[0]).toContain('settings')
  })

  test('fails raw initial and asynchronous chunk budgets', () => {
    const { root, manifest } = fixture({ entrySize: 101, sharedSize: 1, lazySize: 101 })
    const report = analyzeFrontendBundle({
      manifest,
      assetsRoot: root,
      limits: {
        ...DEFAULT_BUNDLE_LIMITS,
        maxInitialBytes: 100,
        maxAsyncBytes: 100,
      },
    })

    expect(report.errors.some((error) => error.includes('Initial JavaScript'))).toBe(true)
    expect(report.errors.some((error) => error.includes('Async chunk'))).toBe(true)
  })

  test('fails JavaScript request and route gzip budgets independently', () => {
    const { root, manifest } = fixture({ entrySize: 2_000, sharedSize: 2_000, lazySize: 2_000 })
    const report = analyzeFrontendBundle({
      manifest,
      assetsRoot: root,
      limits: {
        ...DEFAULT_BUNDLE_LIMITS,
        maxJavaScriptChunks: 5,
        routeGraphs: {
          systems: { roots: ['src/App.tsx'], maxRequests: 2, maxGzipBytes: 1 },
        },
      },
    })

    expect(report.errors.some((error) => error.includes('chunk count'))).toBe(true)
    expect(report.errors.some((error) => error.includes('systems route graph requires'))).toBe(true)
    expect(report.errors.some((error) => error.includes('systems route graph is'))).toBe(true)
  })
})
