#!/usr/bin/env bun

import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { refreshTrivyDatabase, trivyCommand } from './container-security/trivy.mjs'
import {
  demoSmokeRunCommand,
  smokeHealthCommand,
  smokeIdentityAuditCommand,
  smokeRunCommand,
} from './container-security/smoke-runtime.mjs'
import { releasePaths } from './local-release/config.mjs'
import { ensureAgentArtifact, materializeAgentArtifact } from './release-artifacts/agent-store.mjs'
import { ensureWasmArtifact, materializeWasmArtifact } from './release-artifacts/store.mjs'
import { verifyCurrentGoToolchain } from './container-security/go-toolchain-policy.mjs'

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

async function waitForHealth(containerName, expectedMode = 'staging') {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await run(smokeHealthCommand(containerName, expectedMode), { capture: true })
      return
    } catch {
      // The container may still be starting.
    }
    await Bun.sleep(1_000)
  }

  await run(['docker', 'logs', containerName])
  throw new Error(`${containerName} did not become healthy within 30 seconds.`)
}

async function smokeTest(image, platform, { appMode = 'staging', demoSourceDir = null } = {}) {
  const containerName = `homelab-inventory-security-${appMode}-${platform.replaceAll('/', '-')}-${Date.now()}`
  try {
    const command = appMode === 'demo'
      ? demoSmokeRunCommand({ containerName, platform, image, sourceDir: demoSourceDir })
      : smokeRunCommand({ containerName, platform, image })
    await run(command)
    await waitForHealth(containerName, appMode)
    await run([
      'docker', 'exec', containerName,
      'bun', 'scripts/verify-sqlite-runtime.mjs',
    ])
    await run(smokeIdentityAuditCommand(containerName))
  } finally {
    const cleanup = Bun.spawn(['docker', 'rm', '--force', containerName], {
      cwd: ROOT,
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await cleanup.exited
  }
}

async function createDemoSource() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'homelab-inventory-security-demo-'))
  await fs.mkdir(path.join(directory, 'stores'))
  await Promise.all([
    fs.copyFile(path.join(ROOT, 'server/seed/meta.json'), path.join(directory, 'meta.json')),
    fs.copyFile(path.join(ROOT, 'server/seed/inventory.json'), path.join(directory, 'stores/inventory.json')),
    fs.copyFile(path.join(ROOT, 'server/seed/project.json'), path.join(directory, 'stores/project.json')),
  ])
  return directory
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
  const paths = releasePaths()
  const wasm = await ensureWasmArtifact({ root: ROOT, paths })
  const agent = await ensureAgentArtifact({ root: ROOT, paths })
  await Promise.all([
    materializeWasmArtifact({ root: ROOT, receipt: wasm }),
    materializeAgentArtifact({ root: ROOT, receipt: agent }),
  ])
  await refreshTrivyDatabase(run)

  const version = JSON.parse(await Bun.file(new URL('../package.json', import.meta.url)).text()).version
  const agentPin = JSON.parse(await Bun.file(new URL('../server/agent-release-pin.json', import.meta.url)).text())
  const revision = await run(['git', 'rev-parse', 'HEAD'], { capture: true })
  const builtImages = []
  const demoSourceDir = await createDemoSource()

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
      await smokeTest(image, platform, { appMode: 'demo', demoSourceDir })
      await Promise.all([scanWithScout(image), scanWithTrivy(image)])
    }
  } finally {
    await fs.rm(demoSourceDir, { recursive: true, force: true })
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
