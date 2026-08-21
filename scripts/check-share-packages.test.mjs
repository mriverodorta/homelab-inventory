import { describe, expect, test } from 'vitest'

import {
  assertAllowedTarballFiles,
  assertDependencyDirection,
  assertPublicPackageManifest,
} from './check-share-packages.mjs'

describe('public package publication audit', () => {
  test('requires the catalog protocol public package manifest', () => {
    expect(() => assertPublicPackageManifest({
      name: '@homelab-inventory/catalog-protocol',
      version: '0.1.1',
      private: false,
      type: 'module',
      exports: './src/index.ts',
      files: ['src', 'README.md', 'LICENSE'],
      publishConfig: { access: 'public' },
    })).not.toThrow()

    expect(() => assertPublicPackageManifest({
      name: '@homelab-inventory/catalog-protocol',
      version: '1.0.0',
      private: false,
      type: 'module',
      exports: './src/index.ts',
    })).toThrow('explicit public file allowlist')

    expect(() => assertPublicPackageManifest({
      name: '@homelab-inventory/catalog-protocol',
      version: '1.0.0',
      private: false,
      type: 'module',
      exports: './src/index.ts',
      files: ['src', 'README.md', 'LICENSE'],
      publishConfig: { access: 'public' },
    })).toThrow('version 0.1.1')
  })

  test('accepts only the explicit public package surface', () => {
    expect(() => assertAllowedTarballFiles('@homelab-inventory/catalog-protocol', [
      'package.json',
      'README.md',
      'LICENSE',
      'src/index.ts',
      'src/snapshot.ts',
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
      expect(() => assertAllowedTarballFiles('@homelab-inventory/catalog-protocol', [
        'package.json',
        forbidden,
      ])).toThrow(forbidden)
    })
  }

  test('enforces one-way package dependencies', () => {
    expect(() => assertDependencyDirection(new Map([
      ['@homelab-inventory/catalog-protocol', {}],
      ['@homelab-inventory/share-contract', {}],
      ['@homelab-inventory/viewer-model', { '@homelab-inventory/share-contract': '0.1.0' }],
      ['@homelab-inventory/viewer-react', { '@homelab-inventory/viewer-model': '0.1.0' }],
    ]))).not.toThrow()

    expect(() => assertDependencyDirection(new Map([
      ['@homelab-inventory/catalog-protocol', {}],
      ['@homelab-inventory/share-contract', { '@homelab-inventory/viewer-react': '0.1.0' }],
      ['@homelab-inventory/viewer-model', {}],
      ['@homelab-inventory/viewer-react', {}],
    ]))).toThrow('dependency direction')
  })

  test('keeps independent layer-zero packages isolated', () => {
    expect(() => assertDependencyDirection(new Map([
      ['@homelab-inventory/catalog-protocol', { '@homelab-inventory/share-contract': '0.1.0' }],
      ['@homelab-inventory/share-contract', {}],
      ['@homelab-inventory/viewer-model', {}],
      ['@homelab-inventory/viewer-react', {}],
    ]))).toThrow('dependency direction')
  })
})
