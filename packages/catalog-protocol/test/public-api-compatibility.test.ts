import { describe, expect, it } from 'vitest'
import * as protocol from '../src/index'

describe('catalog protocol public API compatibility', () => {
  it('exposes canonical physical M.2 names without removing 0.1.0 aliases', () => {
    expect(protocol.M2_PHYSICAL_FINGERPRINT_VERSION).toBe(12)
    expect(protocol.M2_AE_FINGERPRINT_VERSION).toBe(protocol.M2_PHYSICAL_FINGERPRINT_VERSION)
    expect(protocol.canonicalizeCatalogItemV12).toBeTypeOf('function')
    expect(protocol.projectM2PhysicalHashValue).toBeTypeOf('function')
    expect(protocol.canonicalModuleKey).toBeTypeOf('function')
    expect(protocol.moduleKeyFitsSocket).toBeTypeOf('function')
    expect(protocol.normalizeUsbGenerationV12).toBeTypeOf('function')
    expect(protocol.usbGenerationAtLeastV12).toBeTypeOf('function')
  })
})
