import { describe, expect, test } from 'bun:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { ensureAgentArtifact, hashAgentBundle, materializeAgentArtifact } from './agent-store.mjs'

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-agent-artifact-'))
  await fs.mkdir(path.join(root, 'source'))
  await fs.mkdir(path.join(root, 'server'))
  await fs.writeFile(path.join(root, 'source', 'agent.go'), 'package main\n')
  await fs.writeFile(path.join(root, 'server', 'agent-release-pin.json'), JSON.stringify({
    version: '1.2.3',
    sourceRevision: 'a'.repeat(40),
  }))
  return {
    root,
    paths: {
      agentArtifactsDir: path.join(root, 'support', 'agent', 'current'),
    },
    contract: { id: 'test-agent', version: 1, inputs: ['source', 'server/agent-release-pin.json'] },
  }
}

async function fakeBuild({ destination }) {
  await fs.writeFile(path.join(destination, 'manifest.json'), '{"version":1}\n')
  await fs.writeFile(path.join(destination, 'agent'), 'binary')
}

async function fakeVerify({ directory, expectedHash = null }) {
  const digest = await hashAgentBundle(directory)
  if (expectedHash && digest !== expectedHash) throw new Error('changed')
  return digest
}

describe('canonical Agent release artifact', () => {
  test('reuses a verified current bundle and rebuilds changed bytes', async () => {
    const { root, paths, contract } = await fixture()
    let builds = 0
    const build = async (options) => { builds += 1; await fakeBuild(options) }
    try {
      const first = await ensureAgentArtifact({ root, paths, contract, build, verify: fakeVerify })
      expect(first.reused).toBe(false)
      const second = await ensureAgentArtifact({ root, paths, contract, build, verify: fakeVerify })
      expect(second.reused).toBe(true)
      expect(builds).toBe(1)

      await fs.writeFile(path.join(second.bundle, 'agent'), 'corrupt')
      expect((await ensureAgentArtifact({ root, paths, contract, build, verify: fakeVerify })).reused).toBe(false)
      expect(builds).toBe(2)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })

  test('materializes identical verified bundles for the app and Docker build context', async () => {
    const { root, paths, contract } = await fixture()
    try {
      const receipt = await ensureAgentArtifact({ root, paths, contract, build: fakeBuild, verify: fakeVerify })
      const outputs = await materializeAgentArtifact({ root, receipt, verify: fakeVerify })
      expect(outputs).toHaveLength(2)
      expect(await hashAgentBundle(outputs[0])).toBe(receipt.bundleSha256)
      expect(await hashAgentBundle(outputs[1])).toBe(receipt.bundleSha256)
    } finally {
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
