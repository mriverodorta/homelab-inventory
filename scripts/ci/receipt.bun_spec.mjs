import { describe, expect, test } from 'bun:test'
import { computeCiInputFingerprint, validateCiReceipt } from './receipt.mjs'

const revision = 'a'.repeat(40)
const current = {
  receiptVersion: 2,
  revision,
  trackedStatus: '',
  untrackedStatus: '',
  submodules: 'vendor/homelab-inventory-agent=abc123',
  bunVersion: '1.3.14',
  rustVersion: '1.94.1',
  host: { platform: 'darwin', architecture: 'arm64', release: '25.6.0' },
  environment: { NODE_ENV: null, RUSTFLAGS: null },
  contractVersion: 4,
  contractHashes: { 'package.json': 'hash-a' },
  phaseContractHash: 'phase-contract-a',
}
current.inputFingerprint = computeCiInputFingerprint(current)
const receipt = { ...current, passed: true, completedAt: '2026-08-15T00:00:00.000Z' }

describe('CI receipt validation', () => {
  test('accepts an exact clean committed revision', () => {
    expect(validateCiReceipt(receipt, current, revision)).toEqual(receipt)
  })

  test.each([
    ['missing receipt', null, current, /missing/i],
    ['stale revision', receipt, { ...current, revision: 'b'.repeat(40) }, /revision/i],
    ['dirty tracked files', receipt, { ...current, trackedStatus: ' M package.json' }, /tracked/i],
    ['unexpected untracked files', receipt, { ...current, untrackedStatus: 'scratch.ts' }, /untracked/i],
    ['dirty submodule', receipt, { ...current, submodules: 'vendor/homelab-inventory-agent=def456' }, /submodule/i],
    ['changed contract', receipt, { ...current, contractHashes: { 'package.json': 'hash-b' } }, /contract/i],
    ['changed phase contract', receipt, { ...current, phaseContractHash: 'phase-contract-b' }, /phase contract/i],
    ['changed host', receipt, { ...current, host: { ...current.host, release: '26.0.0' } }, /host/i],
    ['changed environment', receipt, { ...current, environment: { NODE_ENV: 'production', RUSTFLAGS: null } }, /environment/i],
    ['wrong Bun', receipt, { ...current, bunVersion: '1.3.15' }, /Bun/i],
    ['wrong Rust', receipt, { ...current, rustVersion: '1.95.0' }, /Rust/i],
  ])('rejects %s', (_name, saved, actual, message) => {
    expect(() => validateCiReceipt(saved, actual, actual.revision)).toThrow(message)
  })

  test('rejects legacy and unsuccessful receipts', () => {
    expect(() => validateCiReceipt({ ...receipt, receiptVersion: 1 }, current, revision)).toThrow(/version/i)
    expect(() => validateCiReceipt({ ...receipt, passed: false }, current, revision)).toThrow(/successful/i)
  })

  test('computes a stable fingerprint without result metadata', () => {
    expect(computeCiInputFingerprint(current)).toBe(current.inputFingerprint)
    expect(computeCiInputFingerprint({ ...current, completedAt: 'later', passed: true })).toBe(current.inputFingerprint)
    expect(computeCiInputFingerprint({ ...current, environment: { NODE_ENV: 'test', RUSTFLAGS: null } }))
      .not.toBe(current.inputFingerprint)
  })
})
