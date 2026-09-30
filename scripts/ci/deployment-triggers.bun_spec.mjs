import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'

describe('GitHub deployment trigger policy', () => {
  test('Dependabot uses Bun to update the manifest and Bun lockfile together', async () => {
    const config = Bun.YAML.parse(await fs.readFile(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
    const updates = config.updates.filter((entry) => entry.directory === '/')
    expect(updates.filter((entry) => entry['package-ecosystem'] === 'bun')).toHaveLength(1)
    expect(updates.some((entry) => entry['package-ecosystem'] === 'npm')).toBe(false)
  })

  test('Dependabot groups React, its renderer and types for version and security updates', async () => {
    const config = Bun.YAML.parse(await fs.readFile(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
    const bun = config.updates.find((entry) => entry['package-ecosystem'] === 'bun')
    for (const appliesTo of ['version-updates', 'security-updates']) {
      const group = Object.values(bun.groups ?? {}).find((entry) => entry['applies-to'] === appliesTo)
      expect(group).toBeDefined()
      expect(group.patterns).toEqual(['react', 'react-dom', '@types/react', '@types/react-dom'])
      expect(group['exclude-patterns'] ?? []).toEqual([])
      expect(group['update-types']).toBeUndefined()
    }
  })

  test('React and React DOM stay aligned in the manifest and installed lockfile', async () => {
    const manifest = JSON.parse(await fs.readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(manifest.dependencies.react).toBe(manifest.dependencies['react-dom'])
    const installed = await Promise.all(['react', 'react-dom', '@types/react', '@types/react-dom'].map(async (name) =>
      JSON.parse(await fs.readFile(new URL(`../../node_modules/${name}/package.json`, import.meta.url), 'utf8'))))
    expect(installed[0].version).toBe(installed[1].version)
    expect(Bun.semver.satisfies(installed[0].version, installed[1].peerDependencies.react)).toBe(true)
    expect(Bun.semver.satisfies(installed[2].version, installed[3].peerDependencies['@types/react'])).toBe(true)
  })

  test('Dependabot groups CodeQL steps for both version and security updates', async () => {
    const config = Bun.YAML.parse(await fs.readFile(new URL('../../.github/dependabot.yml', import.meta.url), 'utf8'))
    const actions = config.updates.find((entry) => entry['package-ecosystem'] === 'github-actions')
    for (const appliesTo of ['version-updates', 'security-updates']) {
      const group = Object.values(actions.groups ?? {}).find((entry) => entry['applies-to'] === appliesTo)
      expect(group).toBeDefined()
      expect(group.patterns).toEqual(['github/codeql-action/*'])
      expect(group['exclude-patterns'] ?? []).toEqual([])
      expect(group['update-types']).toBeUndefined()
    }
  })

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
