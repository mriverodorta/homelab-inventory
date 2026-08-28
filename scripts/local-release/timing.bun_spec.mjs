import { describe, expect, test } from 'bun:test'
import { formatTimingSummary, runTimedPhase, upsertPhaseReceipt } from './timing.mjs'

describe('local release phase timing', () => {
  test('records a successful phase with monotonic duration', async () => {
    const ticks = [100, 375]
    const walls = [new Date('2026-08-28T12:00:00.000Z'), new Date('2026-08-28T12:00:00.275Z')]
    const receipts = []

    const value = await runTimedPhase({
      id: 'local-ci',
      sourceFingerprint: 'a'.repeat(64),
      operation: async () => 'passed',
      monotonicNow: () => ticks.shift(),
      wallNow: () => walls.shift(),
      onReceipt: async (receipt) => receipts.push(receipt),
    })

    expect(value).toBe('passed')
    expect(receipts).toEqual([{
      id: 'local-ci',
      sourceFingerprint: 'a'.repeat(64),
      startedAt: '2026-08-28T12:00:00.000Z',
      completedAt: '2026-08-28T12:00:00.275Z',
      durationMs: 275,
      outcome: 'passed',
    }])
  })

  test('records failure without persisting error text or command output', async () => {
    const receipts = []
    await expect(runTimedPhase({
      id: 'security-scan',
      sourceFingerprint: 'b'.repeat(64),
      operation: async () => { throw new Error('secret-token-value') },
      monotonicNow: (() => { const values = [10, 20]; return () => values.shift() })(),
      wallNow: (() => {
        const values = [new Date('2026-08-28T12:00:00.000Z'), new Date('2026-08-28T12:00:00.010Z')]
        return () => values.shift()
      })(),
      onReceipt: async (receipt) => receipts.push(receipt),
    })).rejects.toThrow('secret-token-value')

    expect(JSON.stringify(receipts)).not.toContain('secret-token-value')
    expect(receipts[0].outcome).toBe('failed')
  })

  test('records an operation-provided successful reuse outcome', async () => {
    const ticks = [100, 110]
    const walls = [new Date('2026-08-28T12:00:00.000Z'), new Date('2026-08-28T12:00:00.010Z')]
    const receipts = []

    await runTimedPhase({
      id: 'local-ci',
      sourceFingerprint: 'a'.repeat(64),
      operation: async () => ({ timingOutcome: 'passed-reused' }),
      monotonicNow: () => ticks.shift(),
      wallNow: () => walls.shift(),
      onReceipt: async (receipt) => receipts.push(receipt),
    })

    expect(receipts[0].outcome).toBe('passed-reused')
  })

  test('replaces a retried phase and formats the critical-path summary', () => {
    const first = { id: 'arm64-build', durationMs: 2_000, outcome: 'failed' }
    const retry = { id: 'arm64-build', durationMs: 1_500, outcome: 'passed' }
    const ci = { id: 'local-ci', durationMs: 500, outcome: 'passed' }
    const receipts = upsertPhaseReceipt(upsertPhaseReceipt([first], retry), ci)

    expect(receipts).toEqual([retry, ci])
    expect(formatTimingSummary(receipts)).toContain('arm64-build')
    expect(formatTimingSummary(receipts)).toContain('00:01.500')
    expect(formatTimingSummary(receipts)).toContain('Total')
  })
})
