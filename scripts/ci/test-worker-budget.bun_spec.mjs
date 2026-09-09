import { expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import { vitestWorkerBudget } from './test-worker-budget.ts'

test.each([[1, 1], [2, 1], [4, 3], [8, 7], [12, 8], [64, 8]])(
  'limits Vitest on %i CPUs to %i workers while Bun runs alongside it',
  (cpus, expected) => expect(vitestWorkerBudget(cpus)).toBe(expected),
)

test('the standard test command does not override the configured worker budget', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'))
  expect(manifest.scripts['test:vitest']).not.toContain('--maxWorkers')
  const configuration = await fs.readFile(new URL('../../vite.config.ts', import.meta.url), 'utf8')
  expect(configuration).toContain('maxWorkers: vitestWorkerBudget()')
})
