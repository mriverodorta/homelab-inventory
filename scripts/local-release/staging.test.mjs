import { describe, expect, test } from 'bun:test'
import { createApproval, stagingRunCommand } from './staging.mjs'

const candidate = {
  platform: 'linux/arm64',
  image: 'homelab-inventory-candidate:abc-arm64',
  digest: `sha256:${'a'.repeat(64)}`,
  revision: 'b'.repeat(40),
  sourceFingerprint: 'c'.repeat(64),
}

describe('local release staging', () => {
  test('runs the exact ARM64 candidate on loopback with isolated staging policy', () => {
    const command = stagingRunCommand(candidate, { currentDataDir: '/private/staging data/current' })
    expect(command).toContain(candidate.image)
    expect(command).toContain('127.0.0.1:8799:8798')
    expect(command).toContain('type=bind,source=/private/staging data/current,target=/data')
    expect(command).toContain('APP_MODE=staging')
    expect(command).toContain('UPDATE_CHECK_ENABLED=false')
    expect(command).toContain('REGISTRY_REFRESH_INTERVAL_MS=0')
    expect(command).not.toContain('--privileged')
  })

  test('binds approval to source, snapshot, image, and post-start data', () => {
    const identity = {
      revision: candidate.revision,
      sourceFingerprint: candidate.sourceFingerprint,
      trackedClean: true,
    }
    const approval = createApproval({
      identity,
      candidate,
      snapshot: { createdAt: '2026-08-13T00:00:00.000Z' },
      sanitizedData: { fingerprint: 'd'.repeat(64) },
      check: {
        candidateDigest: candidate.digest,
        dataFingerprint: 'e'.repeat(64),
        containerId: 'container',
        imageId: 'image',
      },
    })
    expect(approval.binding).toMatch(/^[a-f0-9]{64}$/)
    expect(approval.candidateDigest).toBe(candidate.digest)
  })

  test('rejects approval after source or candidate drift', () => {
    expect(() => createApproval({
      identity: { revision: 'different', sourceFingerprint: candidate.sourceFingerprint, trackedClean: true },
      candidate,
      snapshot: {},
      sanitizedData: {},
      check: { candidateDigest: candidate.digest },
    })).toThrow('no longer matches')
  })
})
