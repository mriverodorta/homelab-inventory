import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { runConcurrentTestFamilies } from './test-supervisor.mjs'

async function context() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hli-test-supervisor-'))
  return { root, logRoot: path.join(root, 'logs') }
}

function bunEval(source) {
  return [process.execPath, '-e', source]
}

describe('concurrent CI test supervisor', () => {
  test('runs independent families concurrently with inherited environment and removes logs', async () => {
    const { root, logRoot } = await context()
    const first = path.join(root, 'first.txt')
    const second = path.join(root, 'second.txt')
    const result = await runConcurrentTestFamilies({
      root,
      logRoot,
      environment: { ...process.env, SUPERVISOR_VALUE: 'forwarded' },
      jobs: [
        {
          id: 'vitest',
          command: bunEval(`await Bun.sleep(150); await Bun.write(${JSON.stringify(first)}, process.env.SUPERVISOR_VALUE)`),
        },
        {
          id: 'bun',
          command: bunEval(`await Bun.sleep(150); await Bun.write(${JSON.stringify(second)}, 'passed')`),
        },
      ],
      output: () => {},
    })

    expect(await fs.readFile(first, 'utf8')).toBe('forwarded')
    expect(await fs.readFile(second, 'utf8')).toBe('passed')
    expect(result.jobs.map((job) => job.id).sort()).toEqual(['bun', 'vitest'])
    expect(result.jobs.every((job) => Number.isInteger(job.durationMs) && job.durationMs >= 0)).toBe(true)
    expect(result.durationMs).toBeLessThan(result.jobs.reduce((sum, job) => sum + job.durationMs, 0) - 100)
    await expect(fs.stat(logRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  test('reports the failing log, terminates its sibling, and removes temporary logs', async () => {
    const { root, logRoot } = await context()
    const escaped = path.join(root, 'escaped.txt')

    await expect(runConcurrentTestFamilies({
      root,
      logRoot,
      jobs: [
        {
          id: 'failure',
          command: bunEval("console.error('specific failure'); process.exit(7)"),
        },
        {
          id: 'slow-sibling',
          command: bunEval(`await Bun.sleep(600); await Bun.write(${JSON.stringify(escaped)}, 'not-terminated')`),
        },
      ],
      output: () => {},
      shutdownTimeoutMs: 100,
    })).rejects.toThrow('failure failed with exit code 7')

    await Bun.sleep(700)
    await expect(fs.stat(escaped)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(fs.stat(logRoot)).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
