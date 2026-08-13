import { createHash } from 'node:crypto'
import { STAGING_CONTAINER, STAGING_PORT } from './config.mjs'
import { run } from './process.mjs'
import { validateStagingData } from './sanitize.mjs'

const STAGING_ENVIRONMENT = Object.freeze({
  APP_MODE: 'staging',
  NODE_ENV: 'production',
  PORT: '8798',
  DATA_DIR: '/data',
  SEED_EMPTY_DATA: 'false',
  UPDATE_CHECK_ENABLED: 'false',
  REGISTRY_REFRESH_INTERVAL_MS: '0',
})

export function stagingRunCommand(candidate, paths) {
  const command = [
    'docker', 'run', '--detach', '--name', STAGING_CONTAINER,
    '--platform', candidate.platform,
    '--restart', 'no',
    '--publish', `127.0.0.1:${STAGING_PORT}:8798`,
    '--mount', `type=bind,source=${paths.currentDataDir},target=/data`,
  ]
  for (const [name, value] of Object.entries(STAGING_ENVIRONMENT)) command.push('--env', `${name}=${value}`)
  command.push(candidate.image)
  return command
}

async function waitForStagingHealth({ timeoutMs = 120_000 } = {}) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${STAGING_PORT}/api/health`)
      const payload = await response.json()
      if (response.ok && payload.ok === true && payload.mode === 'staging') return payload
    } catch {}
    await Bun.sleep(1_000)
  }
  await run(['docker', 'logs', '--tail', '200', STAGING_CONTAINER], { allowFailure: true })
  throw new Error(`Staging did not become healthy on 127.0.0.1:${STAGING_PORT}.`)
}

export async function stopStaging() {
  await run(['docker', 'rm', '--force', STAGING_CONTAINER], { allowFailure: true, log: false })
}

export async function deployStaging(candidate, paths) {
  await stopStaging()
  await run(stagingRunCommand(candidate, paths))
  return await waitForStagingHealth()
}

function inspectMount(inspect, paths) {
  const mount = inspect.Mounts?.find((entry) => entry.Destination === '/data')
  return mount?.Type === 'bind' && mount.Source === paths.currentDataDir && mount.RW === true
}

export async function checkStaging(candidate, paths) {
  const { stdout } = await run(['docker', 'inspect', STAGING_CONTAINER], { capture: true, log: false })
  const inspect = JSON.parse(stdout)[0]
  if (!inspect?.State?.Running) throw new Error('Staging container is not running.')
  if (inspect.Config?.Image !== candidate.image) throw new Error('Staging is not running the approved candidate image.')
  const binding = inspect.NetworkSettings?.Ports?.['8798/tcp']?.[0]
  if (binding?.HostIp !== '127.0.0.1' || Number(binding.HostPort) !== STAGING_PORT) {
    throw new Error('Staging is not bound exclusively to 127.0.0.1:8799.')
  }
  if (!inspectMount(inspect, paths)) throw new Error('Staging is not using the current sanitized data snapshot.')
  const environment = Object.fromEntries((inspect.Config?.Env ?? []).map((entry) => entry.split(/=(.*)/s).slice(0, 2)))
  for (const [name, expected] of Object.entries(STAGING_ENVIRONMENT)) {
    if (environment[name] !== expected) throw new Error(`Staging environment ${name} is not isolated.`)
  }
  const health = await waitForStagingHealth({ timeoutMs: 5_000 })
  const data = await validateStagingData(paths.currentDataDir, { allowGeneratedMigrationBackups: true })
  const image = await run([
    'docker', 'image', 'inspect', '--format', '{{json .Config.Labels}}', candidate.image,
  ], { capture: true, log: false })
  const labels = JSON.parse(image.stdout)
  if (labels['org.opencontainers.image.revision'] !== candidate.revision) {
    throw new Error('Staging image revision does not match the candidate receipt.')
  }
  return {
    checkedAt: new Date().toISOString(),
    containerId: inspect.Id,
    imageId: inspect.Image,
    candidateDigest: candidate.digest,
    dataFingerprint: data.fingerprint,
    health,
  }
}

export function createApproval({ identity, candidate, snapshot, sanitizedData, check }) {
  if (!identity?.trackedClean) throw new Error('Tracked worktree changes prevent staging approval.')
  if (candidate.revision !== identity.revision || candidate.sourceFingerprint !== identity.sourceFingerprint) {
    throw new Error('The staging candidate no longer matches the release inputs.')
  }
  if (!snapshot || !sanitizedData || !check || check.candidateDigest !== candidate.digest) {
    throw new Error('Staging approval requires a complete, validated candidate run.')
  }
  const approvedAt = new Date().toISOString()
  const binding = createHash('sha256').update(JSON.stringify({
    revision: identity.revision,
    sourceFingerprint: identity.sourceFingerprint,
    candidateDigest: candidate.digest,
    snapshotCreatedAt: snapshot.createdAt,
    sanitizedFingerprint: sanitizedData.fingerprint,
    runtimeDataFingerprint: check.dataFingerprint,
    containerId: check.containerId,
    imageId: check.imageId,
  })).digest('hex')
  return { approvedAt, binding, candidateDigest: candidate.digest, check }
}

export async function stagingLogs() {
  await run(['docker', 'logs', '--tail', '300', STAGING_CONTAINER])
}
