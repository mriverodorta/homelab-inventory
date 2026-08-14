#!/usr/bin/env bun

import { verifyCurrentGoToolchain } from './container-security/go-toolchain-policy.mjs'
import { refreshTrivyDatabase, trivyCommand } from './container-security/trivy.mjs'

const ROOT = new URL('../', import.meta.url).pathname
const PLATFORMS = ['linux/amd64', 'linux/arm64']
const SEVERITIES = 'critical,high,medium,low,unspecified'

function commandText(command) {
  return command.map((part) => /\s/.test(part) ? JSON.stringify(part) : part).join(' ')
}

async function run(command, options = {}) {
  console.log(`\n$ ${commandText(command)}`)
  const process = Bun.spawn(command, {
    cwd: ROOT,
    env: { ...Bun.env, ...(options.env ?? {}) },
    stdout: options.capture ? 'pipe' : 'inherit',
    stderr: options.capture ? 'pipe' : 'inherit',
  })
  const exitCode = await process.exited
  const stdout = options.capture ? await new Response(process.stdout).text() : ''
  const stderr = options.capture ? await new Response(process.stderr).text() : ''
  if (exitCode !== 0) {
    if (stdout) console.error(stdout.trim())
    if (stderr) console.error(stderr.trim())
    throw new Error(`${command[0]} exited with code ${exitCode}.`)
  }
  return stdout.trim()
}

async function commandAvailable(command) {
  const process = Bun.spawn(command, { cwd: ROOT, stdout: 'ignore', stderr: 'ignore' })
  return (await process.exited) === 0
}

async function waitForHealth(containerName) {
  const portOutput = await run(['docker', 'port', containerName, '8798/tcp'], { capture: true })
  const published = portOutput.split('\n')[0]?.trim()
  const port = published?.match(/:(\d+)$/)?.[1]
  if (!port) throw new Error(`Could not determine the health-check port for ${containerName}.`)

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`)
      if (response.ok) return
    } catch {
      // The container may still be starting.
    }
    await Bun.sleep(1_000)
  }

  await run(['docker', 'logs', containerName])
  throw new Error(`${containerName} did not become healthy within 30 seconds.`)
}

async function smokeTest(image, platform) {
  const containerName = `homelab-inventory-security-${platform.replaceAll('/', '-')}-${Date.now()}`
  try {
    await run([
      'docker', 'run', '--detach', '--name', containerName,
      '--platform', platform,
      '--publish', '127.0.0.1::8798',
      image,
    ])
    await waitForHealth(containerName)
    await run([
      'docker', 'exec', containerName,
      'bun', 'scripts/verify-sqlite-runtime.mjs',
    ])
  } finally {
    const cleanup = Bun.spawn(['docker', 'rm', '--force', containerName], {
      cwd: ROOT,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await cleanup.exited
  }
}

async function scanWithScout(image) {
  await run([
    'docker', 'scout', 'cves',
    '--exit-code',
    '--only-severity', SEVERITIES,
    `local://${image}`,
  ])
}

async function scanWithTrivy(image) {
  await run(trivyCommand([
    'image',
    '--image-src', 'docker',
    '--scanners', 'vuln',
    '--pkg-types', 'os,library',
    '--severity', 'UNKNOWN,LOW,MEDIUM,HIGH,CRITICAL',
    '--ignore-unfixed=false',
    '--exit-code', '1',
    '--timeout', '15m',
    image,
  ], { dockerSocket: true }))
}

async function main() {
  if (Bun.argv.includes('--help')) {
    console.log('Build, smoke-test, and scan the amd64 and arm64 production images with Docker Scout and Trivy.')
    return
  }

  if (!(await commandAvailable(['docker', 'info']))) {
    throw new Error('Docker is unavailable. Start Docker Desktop before running the container security preflight.')
  }
  if (!(await commandAvailable(['docker', 'scout', 'version']))) {
    throw new Error('Docker Scout is unavailable. Install or enable Docker Scout before pushing a release branch.')
  }

  await verifyCurrentGoToolchain()
  await refreshTrivyDatabase(run)

  const version = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text()).version
  const agentPin = JSON.parse(await Bun.file(new URL('../server/agent-release-pin.json', import.meta.url)).text())
  const revision = await run(['git', 'rev-parse', 'HEAD'], { capture: true })
  const builtImages = []

  try {
    await run([
      'sh', 'vendor/homelab-inventory-agent/scripts/test-ubuntu-install.sh', agentPin.version,
    ])
    for (const platform of PLATFORMS) {
      const architecture = platform.split('/')[1]
      const image = `homelab-inventory-security:${architecture}`
      builtImages.push(image)
      await run([
        'docker', 'buildx', 'build',
        '--pull',
        '--load',
        '--platform', platform,
        '--tag', image,
        '--build-arg', `APP_VERSION=${version}`,
        '--build-arg', `APP_REVISION=${revision}`,
        '--build-arg', 'APP_CHANNEL=security-preflight',
        '.',
      ])
      await smokeTest(image, platform)
      await scanWithScout(image)
      await scanWithTrivy(image)
    }
  } finally {
    if (Bun.env.SECURITY_KEEP_IMAGES !== '1') {
      for (const image of builtImages) {
        const cleanup = Bun.spawn(['docker', 'image', 'rm', '--force', image], {
          cwd: ROOT,
          stdout: 'ignore',
          stderr: 'ignore',
        })
        await cleanup.exited
      }
    }
  }

  console.log('\nContainer security preflight passed for linux/amd64 and linux/arm64 with zero known vulnerabilities.')
}

await main()
