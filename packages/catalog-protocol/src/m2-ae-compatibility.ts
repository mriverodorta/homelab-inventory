import type { CatalogUsbGeneration } from './types'

export const USB_GENERATIONS_V12 = [
  'USB 1.1',
  'USB 2.0',
  'USB 3.2 Gen 1',
  'USB 3.2 Gen 2',
  'USB 3.2 Gen 2x2',
  'USB4 20Gbps',
  'USB4 40Gbps',
  'USB4 80Gbps',
] as const satisfies readonly CatalogUsbGeneration[]

const USB_GENERATION_ALIASES = new Map<string, CatalogUsbGeneration>([
  ['1.1', 'USB 1.1'],
  ['2.0', 'USB 2.0'],
  ['usb 1.1', 'USB 1.1'],
  ['usb 2.0', 'USB 2.0'],
  ['usb 3.0', 'USB 3.2 Gen 1'],
  ['usb 3.1 gen 1', 'USB 3.2 Gen 1'],
  ['usb 3.1 gen 2', 'USB 3.2 Gen 2'],
  ['usb 3.2 gen 1', 'USB 3.2 Gen 1'],
  ['usb 3.2 gen 2', 'USB 3.2 Gen 2'],
  ['usb 3.2 gen 2x2', 'USB 3.2 Gen 2x2'],
  ['usb 4', 'USB4 20Gbps'],
  ['usb4 20gbps', 'USB4 20Gbps'],
  ['usb4 40gbps', 'USB4 40Gbps'],
  ['usb4 80gbps', 'USB4 80Gbps'],
])

export function canonicalModuleKey(value: unknown): 'A' | 'E' | 'A+E' | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim().toUpperCase().replace(/\s+/g, '')
  if (normalized === 'A') return 'A'
  if (normalized === 'E') return 'E'
  if (/^(?:A[+\-&/]E|E[+\-&/]A)$/.test(normalized)) return 'A+E'
  return undefined
}

export function moduleKeyFitsSocket(moduleKey: unknown, socketKey: unknown): boolean {
  const module = canonicalModuleKey(moduleKey)
  const socket = canonicalModuleKey(socketKey)
  if (!module || !socket || socket === 'A+E') return module !== undefined && module === socket
  return module === socket || module === 'A+E'
}

export function normalizeUsbGenerationV12(
  value: unknown,
  options: { legacyBoundary?: boolean } = {},
): CatalogUsbGeneration | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const normalized = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()
  const canonical = USB_GENERATION_ALIASES.get(normalized)
  if (canonical && (options.legacyBoundary || canonical.toLowerCase() === normalized)) return canonical
  return undefined
}

export function usbGenerationAtLeastV12(actual: unknown, minimum: unknown): boolean | undefined {
  const actualCanonical = normalizeUsbGenerationV12(actual)
  const minimumCanonical = normalizeUsbGenerationV12(minimum)
  if (!actualCanonical || !minimumCanonical) return undefined
  return USB_GENERATIONS_V12.indexOf(actualCanonical) >= USB_GENERATIONS_V12.indexOf(minimumCanonical)
}
