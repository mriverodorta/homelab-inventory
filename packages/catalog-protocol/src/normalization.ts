import { MANUFACTURER_ALIAS_VERSION } from './types'

const DASH_PATTERN = /[\u2010-\u2015\u2212]/g
const SINGLE_QUOTE_PATTERN = /[\u2018\u2019\u2032]/g
const DOUBLE_QUOTE_PATTERN = /[\u201c\u201d\u2033]/g
const WHITESPACE_PATTERN = /\s+/g

const MANUFACTURER_ALIASES = new Map([
  ['hewlett packard', 'hp'],
  ['hewlett-packard', 'hp'],
  ['hp inc', 'hp'],
  ['hp inc.', 'hp'],
  ['intel corporation', 'intel'],
  ['intel corp', 'intel'],
  ['advanced micro devices', 'amd'],
  ['advanced micro devices inc', 'amd'],
  ['micro-star international', 'msi'],
  ['micro star international', 'msi'],
  ['asustek computer', 'asus'],
  ['asustek computer inc', 'asus'],
])

export function normalizeText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(DASH_PATTERN, '-')
    .replace(SINGLE_QUOTE_PATTERN, "'")
    .replace(DOUBLE_QUOTE_PATTERN, '"')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
}

export function normalizeFingerprintText(value: string): string {
  return normalizeText(value).toLocaleLowerCase('en-US')
}

export function normalizeManufacturer(value: string): string {
  const normalized = normalizeFingerprintText(value).replace(/[.,]+$/g, '')
  return MANUFACTURER_ALIASES.get(normalized) ?? normalized
}

export function normalizeUnitText(value: string): string {
  return normalizeFingerprintText(value)
    .replace(/\s*(gbps|mbps|ghz|mhz|khz|tb|gb|mb|kb|watts?|w)\b/g, '$1')
    .replace(/\bwatts?\b/g, 'w')
}

export function manufacturerAliasVersion(): number {
  return MANUFACTURER_ALIAS_VERSION
}
