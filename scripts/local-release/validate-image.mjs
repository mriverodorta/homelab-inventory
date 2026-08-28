import { run } from './process.mjs'
import { ensureTrivyDatabase, trivyCommand, TRIVY_IMAGE } from '../container-security/trivy.mjs'
import { performance } from 'node:perf_hooks'

export { TRIVY_IMAGE }
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

async function timed(operation, monotonicNow) {
  const started = monotonicNow()
  const value = await operation()
  return { value, durationMs: Math.max(0, Math.round(monotonicNow() - started)) }
}

export async function scanImage(image, {
  execute = run,
  ensureDatabase = () => ensureTrivyDatabase(execute),
  monotonicNow = () => performance.now(),
} = {}) {
  const database = await timed(ensureDatabase, monotonicNow)
  const [scout, trivy] = await Promise.all([
    timed(() => execute(['docker', 'scout', 'cves', '--exit-code', '--only-severity', SECURITY_SEVERITIES, `local://${image}`]), monotonicNow),
    timed(() => execute(trivyCommand([
      'image', '--image-src', 'docker', '--scanners', 'vuln', '--pkg-types', 'os,library',
      '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL', '--ignore-unfixed=false',
      '--exit-code', '1', '--timeout', '15m', image,
    ], { dockerSocket: true })), monotonicNow),
  ])
  return {
    trivyDatabaseMs: database.durationMs,
    scoutMs: scout.durationMs,
    trivyMs: trivy.durationMs,
  }
}

export async function validateLoadedCandidate(candidate, {
  smoke = smokeTestImage,
  scanner = scanImage,
  monotonicNow = () => performance.now(),
} = {}) {
  const smokeResult = await timed(() => smoke(candidate.image, candidate.platform), monotonicNow)
  const scannerTimings = await scanner(candidate.image)
  return {
    ...candidate,
    validatedAt: new Date().toISOString(),
    security: 'passed',
    smoke: 'passed',
    validationTimings: {
      ...(candidate.validationTimings ?? {}),
      smokeMs: smokeResult.durationMs,
      ...scannerTimings,
    },
  }
}
