import { describe, expect, test } from 'vitest'

import {
  assertAllowedTarballFiles,
  assertDependencyDirection,
} from './check-share-packages.mjs'

describe('share package publication audit', () => {
  test('accepts only the explicit public package surface', () => {
    expect(() => assertAllowedTarballFiles('@homelab-inventory/share-contract', [
      'package.json',
      'README.md',
      'LICENSE',
      'src/index.ts',
      'src/schema.ts',
    ])).not.toThrow()
  })

  for (const forbidden of [
    '.env',
    'data/stores/inventory.json',
    'screenshots/private.png',
    'src/index.ts.map',
    'src/server/index.mjs',
    'src/editor/workbench.tsx',
    'credentials.json',
    'test/schema.test.ts',
  ]) {
    test(`rejects ${forbidden}`, () => {
      expect(() => assertAllowedTarballFiles('@homelab-inventory/share-contract', [
        'package.json',
        forbidden,
      ])).toThrow(forbidden)
    })
  }

  test('enforces one-way package dependencies', () => {
    expect(() => assertDependencyDirection(new Map([
      ['@homelab-inventory/share-contract', {}],
      ['@homelab-inventory/viewer-model', { '@homelab-inventory/share-contract': '0.1.0' }],
      ['@homelab-inventory/viewer-react', { '@homelab-inventory/viewer-model': '0.1.0' }],
    ]))).not.toThrow()

    expect(() => assertDependencyDirection(new Map([
      ['@homelab-inventory/share-contract', { '@homelab-inventory/viewer-react': '0.1.0' }],
      ['@homelab-inventory/viewer-model', {}],
      ['@homelab-inventory/viewer-react', {}],
    ]))).toThrow('dependency direction')
  })
})
