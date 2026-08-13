import { run } from './process.mjs'

export const TRIVY_IMAGE = 'aquasec/trivy:0.73.0@sha256:7cced7cae583819fc7806d4cbc0dbbc7cad18b99f7d3e235192e6da8c091045c'
export const SECURITY_SEVERITIES = 'critical,high,medium,low,unspecified'

export async function waitForContainerHealth(containerName) {
  const { stdout } = await run(['docker', 'port', containerName, '8798/tcp'], { capture: true, log: false })
  const port = stdout.split('\n')[0]?.match(/:(\d+)$/)?.[1]
  if (!port) throw new Error(`Could not determine the health port for ${containerName}.`)
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return Number(port)
    } catch {}
    await Bun.sleep(1_000)
  }
  await run(['docker', 'logs', containerName])
  throw new Error(`${containerName} did not become healthy within 60 seconds.`)
}

export async function smokeTestImage(image, platform) {
  const containerName = `homelab-inventory-release-smoke-${platform.split('/')[1]}-${Date.now()}`
  try {
    await run(['docker', 'run', '--detach', '--name', containerName, '--platform', platform, '--publish', '127.0.0.1::8798', image])
    await waitForContainerHealth(containerName)
    await run(['docker', 'exec', containerName, 'bun', 'scripts/verify-sqlite-runtime.mjs'])
  } finally {
    await run(['docker', 'rm', '--force', containerName], { allowFailure: true, log: false })
  }
}

export async function scanImage(image) {
  await run(['docker', 'scout', 'cves', '--exit-code', '--only-severity', SECURITY_SEVERITIES, `local://${image}`])
  await run([
    'docker', 'run', '--rm',
    '--volume', '/var/run/docker.sock:/var/run/docker.sock',
    '--volume', 'homelab-inventory-trivy-cache:/root/.cache/',
    TRIVY_IMAGE,
    'image', '--image-src', 'docker', '--scanners', 'vuln', '--pkg-types', 'os,library',
    '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--ignore-unfixed=false',
    '--exit-code', '1', '--timeout', '15m', image,
  ])
}

export async function validateLoadedCandidate(candidate) {
  await smokeTestImage(candidate.image, candidate.platform)
  await scanImage(candidate.image)
  return { ...candidate, validatedAt: new Date().toISOString(), security: 'passed', smoke: 'passed' }
}
