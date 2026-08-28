import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'

describe('GitHub deployment trigger policy', () => {
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
