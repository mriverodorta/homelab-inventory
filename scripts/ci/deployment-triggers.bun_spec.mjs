import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'

describe('GitHub deployment trigger policy', () => {
  test('CodeQL initialization and analysis use the same immutable revision', async () => {
    const workflow = await fs.readFile(new URL('../../.github/workflows/codeql-scheduled.yml', import.meta.url), 'utf8')
    const init = workflow.match(/uses: github\/codeql-action\/init@([a-f0-9]{40})\s/)
    const analyze = workflow.match(/uses: github\/codeql-action\/analyze@([a-f0-9]{40})\s/)
    expect(init).not.toBeNull()
    expect(analyze).not.toBeNull()
    expect(init[1]).toBe(analyze[1])
  })

  test('repository CI runs for pull requests but not deployment branch pushes', async () => {
    const workflow = await fs.readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('pull_request:')
    expect(workflow).not.toContain('push:')
  })

  test('CodeQL and image monitoring are scheduled independently from deployment', async () => {
    for (const relative of ['../../.github/workflows/codeql-scheduled.yml', '../../.github/workflows/docker-security-monitor.yml']) {
      const workflow = await fs.readFile(new URL(relative, import.meta.url), 'utf8')
      expect(workflow).toContain('schedule:')
      expect(workflow).toContain('workflow_dispatch:')
      expect(workflow).not.toContain('push:')
    }
  })
})
