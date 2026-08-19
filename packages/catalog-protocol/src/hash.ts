import { canonicalJson } from './canonicalize'
import { canonicalizeCatalogItemV10, canonicalizeCatalogItemV11, canonicalizeCatalogItemV9 } from './canonical-units'
import { canonicalizeCatalogItemV12, projectM2PhysicalHashValue } from './m2-ae-v12'
import { sanitizeCatalogItem } from './sanitize'
import {
  CATALOG_SCHEMA_VERSION,
  FINGERPRINT_VERSION,
  LEGACY_FINGERPRINT_VERSION,
  CANONICAL_UNITS_FINGERPRINT_VERSION,
  MANUFACTURER_ALIAS_VERSION,
  M2_AE_FINGERPRINT_VERSION,
  NAS_FINGERPRINT_VERSION,
  NETWORK_FINGERPRINT_VERSION,
  type CatalogDigests,
  type CatalogTemplateItem,
} from './types'

const IDENTITY_FIELDS = ['type', 'subtype', 'manufacturer', 'family', 'model', 'number'] as const

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

export function defaultCatalogIdentityPayload(item: CatalogTemplateItem): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
  }
  for (const field of IDENTITY_FIELDS) {
    if (item[field] !== undefined) payload[field] = item[field]
  }
  if (!item.manufacturer && !item.family && !item.model && !item.number) payload.name = item.name
  return payload
}

export function legacyCatalogIdentityPayload(item: CatalogTemplateItem): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion: LEGACY_FINGERPRINT_VERSION,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
  }
  for (const field of IDENTITY_FIELDS) {
    if (item[field] !== undefined) payload[field] = item[field]
  }
  if (!item.manufacturer && !item.family && !item.model && !item.number) payload.name = item.name
  return payload
}

export async function computeCatalogDigests(value: unknown): Promise<CatalogDigests> {
  const item = sanitizeCatalogItem(value)
  return computeCatalogDigestsWithIdentity(item, defaultCatalogIdentityPayload(item))
}

export async function computeCatalogDigestsWithIdentity(
  value: unknown,
  identityPayload: Record<string, unknown>,
  fingerprintVersion = FINGERPRINT_VERSION,
): Promise<CatalogDigests> {
  const item = fingerprintVersion === M2_AE_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV12(value)
    : fingerprintVersion === NETWORK_FINGERPRINT_VERSION
    ? canonicalizeCatalogItemV11(value)
    : fingerprintVersion === NAS_FINGERPRINT_VERSION
      ? canonicalizeCatalogItemV10(value)
    : fingerprintVersion === CANONICAL_UNITS_FINGERPRINT_VERSION
      ? canonicalizeCatalogItemV9(value)
      : sanitizeCatalogItem(value)
  const contentItem = fingerprintVersion === NETWORK_FINGERPRINT_VERSION
    ? { ...item, aliases: undefined }
    : fingerprintVersion === M2_AE_FINGERPRINT_VERSION
      ? projectM2PhysicalHashValue(item as unknown as import('./types').JsonValue)
    : item
  const versionedIdentity = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
    ...identityPayload,
  }
  const identityHash = await sha256Hex(`hli:identity:v${fingerprintVersion}:${canonicalJson(versionedIdentity)}`)
  const contentHash = await sha256Hex(`hli:content:v${fingerprintVersion}:${canonicalJson({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
    item: contentItem,
  })}`)
  return { identityHash, contentHash }
}
