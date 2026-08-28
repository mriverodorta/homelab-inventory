import {
  EXTERNAL_IDENTITY_PATHS,
  ISOLATED_RUNTIME_ENVIRONMENT,
} from '../../server/external-access-policy.mjs'

export const SMOKE_DATA_TMPFS = '/data:rw,noexec,nosuid,nodev,uid=10001,gid=10001,mode=0700'
export const SMOKE_ENVIRONMENT = ISOLATED_RUNTIME_ENVIRONMENT
export const DEMO_SMOKE_ENVIRONMENT = Object.freeze({
  ...ISOLATED_RUNTIME_ENVIRONMENT,
  APP_MODE: 'demo',
})

export function assertSmokeIsolation(command, expectedEnvironment = SMOKE_ENVIRONMENT) {
  const environment = new Map()
  for (let index = 0; index < command.length; index += 1) {
    if (command[index] !== '--env') continue
    const [name, ...parts] = String(command[index + 1] ?? '').split('=')
    environment.set(name, parts.join('='))
  }
  if (!command.includes('--network') || command[command.indexOf('--network') + 1] !== 'none') {
    throw new Error('Container smoke validation requires --network none.')
  }
  if (command.includes('--publish') || command.includes('-p')) {
    throw new Error('Container smoke validation must not publish a host port.')
  }
  for (const [name, value] of Object.entries(expectedEnvironment)) {
    if (environment.get(name) !== value) throw new Error(`Container smoke isolation requires ${name}=${value}.`)
  }
  return command
}

export function smokeRunCommand({ containerName, platform, image }) {
  const command = [
    'docker', 'run', '--detach', '--name', containerName,
    '--platform', platform,
    '--network', 'none',
    '--tmpfs', SMOKE_DATA_TMPFS,
  ]
  for (const [name, value] of Object.entries(SMOKE_ENVIRONMENT)) command.push('--env', `${name}=${value}`)
  command.push(image)
  return assertSmokeIsolation(command)
}

export function demoSmokeRunCommand({ containerName, platform, image, sourceDir }) {
  if (!sourceDir) throw new Error('Demo smoke validation requires an isolated source fixture.')
  const command = [
    'docker', 'run', '--detach', '--name', containerName,
    '--platform', platform,
    '--network', 'none',
    '--tmpfs', SMOKE_DATA_TMPFS,
    '--mount', `type=bind,source=${sourceDir},target=/read-only-data,readonly`,
  ]
  for (const [name, value] of Object.entries(DEMO_SMOKE_ENVIRONMENT)) command.push('--env', `${name}=${value}`)
  command.push(image)
  return assertSmokeIsolation(command, DEMO_SMOKE_ENVIRONMENT)
}

export function smokeHealthCommand(containerName, expectedMode = 'staging') {
  return [
    'docker', 'exec', containerName, 'bun', '-e',
    `const r=await fetch('http://127.0.0.1:8798/api/health');const p=await r.json();if(!r.ok||p.ok!==true||p.mode!==${JSON.stringify(expectedMode)})process.exit(1)`,
  ]
}

export function smokeIdentityAuditCommand(containerName) {
  return [
    'docker', 'exec', containerName, 'bun', '-e',
    `import{existsSync}from'node:fs';const paths=${JSON.stringify(EXTERNAL_IDENTITY_PATHS)};const found=paths.filter(existsSync);if(found.length){console.error('External identity artifacts created:',found.join(','));process.exit(1)}`,
  ]
}
