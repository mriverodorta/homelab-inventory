import { canonicalJson } from './canonicalize'
import { sanitizeCatalogItem } from './sanitize'
import {
  CATALOG_SCHEMA_VERSION,
  FINGERPRINT_VERSION,
  MANUFACTURER_ALIAS_VERSION,
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

export async function computeCatalogDigests(value: unknown): Promise<CatalogDigests> {
  const item = sanitizeCatalogItem(value)
  return computeCatalogDigestsWithIdentity(item, defaultCatalogIdentityPayload(item))
}

export async function computeCatalogDigestsWithIdentity(
  value: unknown,
  identityPayload: Record<string, unknown>,
): Promise<CatalogDigests> {
  const item = sanitizeCatalogItem(value)
  const versionedIdentity = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
    ...identityPayload,
  }
  const identityHash = await sha256Hex(`hli:identity:v${FINGERPRINT_VERSION}:${canonicalJson(versionedIdentity)}`)
  const contentHash = await sha256Hex(`hli:content:v${FINGERPRINT_VERSION}:${canonicalJson({
    schemaVersion: CATALOG_SCHEMA_VERSION,
    fingerprintVersion: FINGERPRINT_VERSION,
    manufacturerAliasVersion: MANUFACTURER_ALIAS_VERSION,
    item,
  })}`)
  return { identityHash, contentHash }
}
