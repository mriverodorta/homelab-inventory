import { describe, expect, it } from 'vitest'
import {
  OFFICIAL_CATALOG_KEYS,
  trustedCatalogKeys,
} from './trusted-keys.mjs'

describe('trusted catalog keys', () => {
  it('trusts the official registry signing key without environment configuration', () => {
    expect(trustedCatalogKeys()).toEqual(OFFICIAL_CATALOG_KEYS)
    expect(OFFICIAL_CATALOG_KEYS).toContainEqual(expect.objectContaining({
      keyId: 'registry-2026-01',
      publicKey: expect.any(String),
    }))
  })

  it('merges additive environment keys and collapses identical duplicates', () => {
    const additional = {
      keyId: 'registry-test-01',
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
      notBefore: '2026-07-28T00:00:00Z',
    }
    const official = OFFICIAL_CATALOG_KEYS[0]

    expect(trustedCatalogKeys(JSON.stringify([
      { keyId: official.keyId, publicKey: official.publicKey },
      additional,
    ]))).toEqual([
      official,
      additional,
    ])
  })

  it('rejects a conflicting key that reuses an official key ID', () => {
    expect(() => trustedCatalogKeys(JSON.stringify([{
      ...OFFICIAL_CATALOG_KEYS[0],
      publicKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }]))).toThrow('conflicts with an existing trusted key')
  })
})
