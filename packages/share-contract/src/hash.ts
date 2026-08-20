import { canonicalShareJson } from './canonicalize'

export async function shareContentHash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalShareJson(value))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
