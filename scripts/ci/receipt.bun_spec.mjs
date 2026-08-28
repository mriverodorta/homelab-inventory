import { describe, expect, test } from 'bun:test'
import { validateCiReceipt } from './receipt.mjs'

const revision = 'a'.repeat(40)
const current = {
  revision,
  trackedStatus: '',
  submodules: 'vendor/homelab-inventory-agent=abc123',
  bunVersion: '1.3.14',
  rustVersion: '1.94.1',
  contractVersion: 3,
  contractHashes: { 'package.json': 'hash-a' },
}
const receipt = { ...current, completedAt: '2026-08-15T00:00:00.000Z' }

describe('CI receipt validation', () => {
  test('accepts an exact clean committed revision', () => {
    expect(validateCiReceipt(receipt, current, revision)).toEqual(receipt)
  })

  test.each([
    ['missing receipt', null, current, /missing/i],
    ['stale revision', receipt, { ...current, revision: 'b'.repeat(40) }, /revision/i],
    ['dirty tracked files', receipt, { ...current, trackedStatus: ' M package.json' }, /tracked/i],
    ['dirty submodule', receipt, { ...current, submodules: 'vendor/homelab-inventory-agent=def456' }, /submodule/i],
    ['changed contract', receipt, { ...current, contractHashes: { 'package.json': 'hash-b' } }, /contract/i],
    ['wrong Bun', receipt, { ...current, bunVersion: '1.3.15' }, /Bun/i],
    ['wrong Rust', receipt, { ...current, rustVersion: '1.95.0' }, /Rust/i],
  ])('rejects %s', (_name, saved, actual, message) => {
    expect(() => validateCiReceipt(saved, actual, actual.revision)).toThrow(message)
  })

  test('does not model untracked files as tracked changes', () => {
    expect(validateCiReceipt(receipt, { ...current, untrackedStatus: '?? scratch/' }, revision)).toEqual(receipt)
  })
})
