import fs from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CanonicalMeasurementError,
  canonicalizeCatalogItemV9,
  digestCatalogTemplate,
  type FingerprintVersion,
} from '../src'

type Fixture = {
  key: string
  sourceFingerprintVersion: FingerprintVersion
  requiredApplicationCatalogContractVersion: 9
  source: Record<string, unknown>
  canonical?: Record<string, unknown>
  identityPayload?: Record<string, unknown>
  identityHash?: string
  contentHash?: string
  historicalIdentityAliases?: Array<{ fingerprintVersion: FingerprintVersion; identityHash: string }>
  error?: { code: string; path: string | null }
}

describe('frozen canonical-units v9 fixtures', () => {
  it('reproduces canonical JSON, hashes, aliases, and stable failures', async () => {
    const file = path.resolve(import.meta.dirname, 'fixtures/canonical-units/v9.json')
    const document = JSON.parse(await fs.readFile(file, 'utf8')) as { schemaVersion: 1; fingerprintVersion: 9; fixtures: Fixture[] }
    expect(document).toMatchObject({ schemaVersion: 1, fingerprintVersion: 9 })
    expect(document.fixtures).toHaveLength(15)

    for (const fixture of document.fixtures) {
      expect(fixture.requiredApplicationCatalogContractVersion).toBe(9)
      if (fixture.error) {
        try {
          canonicalizeCatalogItemV9(fixture.source)
          throw new Error(`Fixture ${fixture.key} unexpectedly canonicalized.`)
        } catch (error) {
          expect(error).toBeInstanceOf(CanonicalMeasurementError)
          expect(error).toMatchObject(fixture.error)
        }
        continue
      }
      const canonical = canonicalizeCatalogItemV9(fixture.source)
      const projected = await digestCatalogTemplate(canonical, { fingerprintVersion: 9 })
      const previous = await digestCatalogTemplate(fixture.source, { fingerprintVersion: fixture.sourceFingerprintVersion })
      expect(projected.item, fixture.key).toEqual(fixture.canonical)
      expect(projected.identityPayload, fixture.key).toEqual(fixture.identityPayload)
      expect(projected.identityHash, fixture.key).toBe(fixture.identityHash)
      expect(projected.contentHash, fixture.key).toBe(fixture.contentHash)
      expect(fixture.historicalIdentityAliases, fixture.key).toEqual([
        { fingerprintVersion: fixture.sourceFingerprintVersion, identityHash: previous.identityHash },
      ])
    }
  })
})
