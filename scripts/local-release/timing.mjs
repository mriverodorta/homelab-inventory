import { performance } from 'node:perf_hooks'

function durationText(durationMs) {
  const milliseconds = Math.max(0, Math.round(durationMs))
  const minutes = Math.floor(milliseconds / 60_000)
  const seconds = Math.floor((milliseconds % 60_000) / 1_000)
  const remainder = milliseconds % 1_000
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(remainder).padStart(3, '0')}`
}

export function upsertPhaseReceipt(receipts = [], receipt) {
  const index = receipts.findIndex((entry) => entry.id === receipt.id)
  if (index === -1) return [...receipts, receipt]
  return receipts.map((entry, entryIndex) => entryIndex === index ? receipt : entry)
}

export async function runTimedPhase({
  id,
  sourceFingerprint,
  operation,
  onReceipt = async () => {},
  monotonicNow = () => performance.now(),
  wallNow = () => new Date(),
}) {
  if (!id || typeof operation !== 'function') throw new Error('Timed release phases require an id and operation.')
  const startedAt = wallNow().toISOString()
  const startedTick = monotonicNow()
  let outcome = 'passed'
  try {
    const result = await operation()
    if (result?.timingOutcome === 'passed-reused') outcome = 'passed-reused'
    return result
  } catch (error) {
    outcome = 'failed'
    throw error
  } finally {
    const completedTick = monotonicNow()
    const completedAt = wallNow().toISOString()
    await onReceipt({
      id,
      sourceFingerprint,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Math.round(completedTick - startedTick)),
      outcome,
    })
  }
}

export function formatTimingSummary(receipts = []) {
  if (receipts.length === 0) return 'No release phase timings recorded.'
  const width = Math.max(...receipts.map((entry) => entry.id.length), 5)
  const lines = receipts.map((entry) => (
    `${entry.id.padEnd(width)}  ${durationText(entry.durationMs)}  ${entry.outcome}`
  ))
  const total = receipts.reduce((sum, entry) => sum + Math.max(0, entry.durationMs || 0), 0)
  return [...lines, `${'Total'.padEnd(width)}  ${durationText(total)}`].join('\n')
}
