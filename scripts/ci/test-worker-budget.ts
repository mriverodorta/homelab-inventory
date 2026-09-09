import { availableParallelism } from 'node:os'

export function vitestWorkerBudget(parallelism = availableParallelism()): number {
  // The test supervisor runs Bun alongside Vitest; leave it one CPU.
  return Math.max(1, Math.min(8, parallelism - 1))
}
