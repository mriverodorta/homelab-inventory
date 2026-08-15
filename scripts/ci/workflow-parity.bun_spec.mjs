import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'

describe('GitHub CI parity', () => {
  test('uses pinned toolchains and the shared repository verification command', async () => {
    const workflow = await fs.readFile(new URL('../../.github/workflows/ci.yml', import.meta.url), 'utf8')
    expect(workflow).toContain('bun-version: 1.3.14')
    expect(workflow).toContain('toolchain: 1.94.1')
    expect(workflow).toContain('run: bun run ci:verify')
    expect(workflow).not.toContain('run: cargo clippy')
    expect(workflow).not.toContain('run: bun run test')
    expect(workflow.indexOf('run: bun run ci:verify')).toBeLessThan(workflow.indexOf('Upload engine benchmark'))
  })
})
