import { normalizeFingerprintText, normalizeManufacturer, normalizeUnitText } from './normalization'
import type { JsonValue } from './types'

const OMIT = Symbol('omit')

function compareCanonical(left: JsonValue, right: JsonValue): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right), 'en-US')
}

function canonicalizeValue(
  value: unknown,
  key: string | undefined,
): JsonValue | typeof OMIT {
  if (value === undefined || value === null || value === '') return OMIT
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return OMIT
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value === 'string') {
    const normalized = key === 'manufacturer' || key === 'secondaryManufacturer'
      ? normalizeManufacturer(value)
      : normalizeUnitText(value)
    return normalized === '' ? OMIT : normalized
  }
  if (Array.isArray(value)) {
    const entries = value
      .map((entry) => canonicalizeValue(entry, undefined))
      .filter((entry): entry is JsonValue => entry !== OMIT)
      .sort(compareCanonical)
    return entries.length === 0 ? OMIT : entries
  }
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    for (const objectKey of Object.keys(value as Record<string, unknown>).sort()) {
      const canonical = canonicalizeValue((value as Record<string, unknown>)[objectKey], objectKey)
      if (canonical !== OMIT) result[normalizeFingerprintText(objectKey)] = canonical
    }
    return Object.keys(result).length === 0 ? OMIT : result
  }
  return OMIT
}

export function canonicalize(value: unknown): JsonValue {
  const canonical = canonicalizeValue(value, undefined)
  return canonical === OMIT ? null : canonical
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}
