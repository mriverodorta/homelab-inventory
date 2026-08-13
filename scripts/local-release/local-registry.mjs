import { run } from './process.mjs'

export const LOCAL_REGISTRY_IMAGE = 'registry:2.8.3@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373'

export async function startLocalRegistry(prefix = 'homelab-inventory-release-registry') {
  const name = `${prefix}-${Date.now()}`
  try {
    // Docker Desktop's daemon runs in a VM, so it cannot pull from a macOS-only loopback binding.
    await run(['docker', 'run', '--detach', '--name', name, '--publish', '0:5000', LOCAL_REGISTRY_IMAGE])
    const { stdout } = await run(['docker', 'port', name, '5000/tcp'], { capture: true, log: false })
    const port = stdout.match(/:(\d+)$/)?.[1]
    if (!port) throw new Error('Could not determine local release registry port.')
    for (let attempt = 0; attempt < 30; attempt += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/v2/`)
        if (response.ok) return { name, repository: `localhost:${port}/homelab-inventory` }
      } catch {}
      await Bun.sleep(500)
    }
    throw new Error('Local release registry did not become ready.')
  } catch (error) {
    await run(['docker', 'rm', '--force', name], { allowFailure: true, log: false })
    throw error
  }
}

export async function stopLocalRegistry(registry) {
  if (registry) await run(['docker', 'rm', '--force', registry.name], { allowFailure: true, log: false })
}
