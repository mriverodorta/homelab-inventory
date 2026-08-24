import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentReleaseService, registerAgentReleaseRoutes } from './release-service.mjs'

const directories = []

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-release-'))
  directories.push(directory)
  const names = [
    'homelab-inventory-agent-linux-amd64', 'homelab-inventory-agent-linux-arm64', 'homelab-inventory-agent-freebsd-amd64',
    'install.sh', 'install-freebsd.sh', 'homelab-inventory-agent.service', 'homelab_inventory_agent', 'uninstall.sh',
    'uninstall-freebsd.sh', 'version.txt', ...Array.from({ length: 9 }, (_, index) => `schemas/schema-${index}.schema.json`),
  ]
  const assets = []
  for (const name of names) {
    const body = Buffer.from(`fixture:${name}\n`)
    await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true })
    await fs.writeFile(path.join(directory, name), body)
    assets.push({ path: name, sha256: createHash('sha256').update(body).digest('hex'), bytes: body.byteLength })
  }
  await fs.writeFile(path.join(directory, 'checksums.txt'), `${assets.map((asset) => `${asset.sha256}  ${asset.path}`).join('\n')}\n`)
  await fs.writeFile(path.join(directory, 'manifest.json'), `${JSON.stringify({
    version: '0.1.0', sourceRevision: 'a'.repeat(40), protocolMajor: 1, assets,
  })}\n`)
  return directory
}

afterEach(async () => Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))))

describe('embedded agent release', () => {
  it('verifies every asset and creates typed install commands', async () => {
    const service = new AgentReleaseService({ directory: await fixture() })
    await service.initialize()
    const commands = service.installCommands({
      endpoint: 'https://inventory.example.com', hostType: 'nas', hostId: 4, activationToken: 'secret-token',
      containers: { mode: 'proxy', runtime: 'docker', endpoint: 'http://127.0.0.1:2375' },
    })
    expect(commands.linux).toContain("--host-type' 'nas")
    expect(commands.linux).toContain("--containers-mode' 'proxy")
    expect(commands.alpine).toContain('install.sh')
    expect(commands.alpine).toContain("--host-type' 'nas")
    expect(commands.alpine).toContain("--containers-mode' 'proxy")
    expect(commands.alpine).not.toMatch(/\bsudo\b/u)
    expect(commands.freebsd).toContain('install-freebsd.sh')
    expect(service.upgradeCommands('https://inventory.example.com', { native: true })).toEqual({
      linux: 'sudo homelab-inventory-agent update',
      alpine: 'homelab-inventory-agent update',
      freebsd: 'sudo homelab-inventory-agent update',
    })
    expect(service.upgradeCommands('https://inventory.example.com').linux).toContain('install.sh')
    expect(service.upgradeCommands('https://inventory.example.com').linux).toContain('--upgrade')
    expect(service.upgradeCommands('https://inventory.example.com').alpine).toContain('install.sh')
    expect(service.upgradeCommands('https://inventory.example.com').alpine).toContain('--upgrade')
    expect(service.upgradeCommands('https://inventory.example.com').alpine).not.toMatch(/\bsudo\b/u)
    expect(service.updateAvailable('0.0.9')).toBe(true)
    expect(service.updateAvailable('0.1.0')).toBe(false)
  })

  it('fails initialization when an embedded byte changes', async () => {
    const directory = await fixture()
    await fs.appendFile(path.join(directory, 'install.sh'), 'tampered')
    await expect(new AgentReleaseService({ directory }).initialize()).rejects.toThrow('failed verification')
  })

  it('serves immutable assets and denies every demo download', async () => {
    const service = new AgentReleaseService({ directory: await fixture() })
    await service.initialize()
    for (const disabled of [false, true]) {
      const app = express()
      registerAgentReleaseRoutes(app, service, { disabled })
      const server = await new Promise((resolve) => {
        const listener = app.listen(0, () => resolve(listener))
      })
      try {
        const url = `http://127.0.0.1:${server.address().port}`
        const response = await fetch(`${url}/api/agent/releases/0.1.0/install.sh`)
        expect(response.status).toBe(disabled ? 403 : 200)
        if (!disabled) expect(response.headers.get('cache-control')).toContain('immutable')
        const checksums = await fetch(`${url}/api/agent/releases/0.1.0/checksums.txt`)
        expect(checksums.status).toBe(disabled ? 403 : 200)
        const current = await fetch(`${url}/api/agent/releases/current`)
        expect(current.status).toBe(disabled ? 403 : 200)
        if (!disabled) {
          expect(current.headers.get('cache-control')).toBe('no-store')
          expect(await current.json()).toEqual({
            version: '0.1.0',
            sourceRevision: 'a'.repeat(40),
            protocolMajor: 1,
            manifestUrl: '/api/agent/releases/0.1.0/manifest.json',
          })
        }
      } finally {
        await new Promise((resolve) => server.close(resolve))
      }
    }
  })
})
