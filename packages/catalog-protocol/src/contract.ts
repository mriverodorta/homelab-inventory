import { digestCatalogTemplate } from './projector'
import { FINGERPRINT_VERSION, LEGACY_FINGERPRINT_VERSION } from './types'

const FINGERPRINT_V2_CPU_VECTOR = {
  item: {
    type: 'cpu',
    name: 'Intel Core i5-10500T',
    manufacturer: 'Intel',
    family: 'Core i5',
    model: 'i5-10500T',
    specs: {
      cores: 6,
      socket: 'LGA1200',
      threads: 12,
      tdpWatts: 35,
      generation: '10th Gen',
      baseClockGhz: 2.3,
      boostClockGhz: 3.8,
    },
  },
  identityHash: 'f253f149aac5c3df2ec7bff68f985e49138ebe6f7c19795536738f23b0969416',
  contentHash: 'e404ed4bb011bda97f3d2edfe9d07e4ccc0caa816ff35c3a6c51029501590af2',
} as const

export async function assertCatalogProtocolContract(): Promise<void> {
  if (FINGERPRINT_VERSION !== 3 || LEGACY_FINGERPRINT_VERSION !== 2) {
    throw new Error(`Catalog fingerprint version ${FINGERPRINT_VERSION} has no publication contract.`)
  }

  const projection = await digestCatalogTemplate(FINGERPRINT_V2_CPU_VECTOR.item, {
    fingerprintVersion: LEGACY_FINGERPRINT_VERSION,
  })
  if (
    projection.identityHash !== FINGERPRINT_V2_CPU_VECTOR.identityHash
    || projection.contentHash !== FINGERPRINT_V2_CPU_VECTOR.contentHash
  ) {
    throw new Error('Catalog fingerprint-v2 implementation does not match its immutable publication contract.')
  }
}
