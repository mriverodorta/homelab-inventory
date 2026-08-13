import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { run } from './process.mjs'

export const ORAS_VERSION = '1.3.3'
const ORAS_SHA256 = Object.freeze({
  'darwin-amd64': 'aeb684d8c24c18dce28fd1f7326636e4782b573108e244a93d4b1c4a5ec50f48',
  'darwin-arm64': 'f33fc12753c54172b0d0d19eaa0318d3f90fe9b094d96e8b259c881713c92e1c',
  'linux-amd64': '9ce999f8d2de03fc03968b29d743077a58783e545e5eaa53917ca177352d0e59',
  'linux-arm64': 'ac7156f93a21e903f7ad606c792f3560f17e0cd0e36365634701b1e7cc4e4eca',
})

export function orasDistribution(platform = process.platform, architecture = process.arch) {
  const osName = platform === 'darwin' ? 'darwin' : platform === 'linux' ? 'linux' : null
  const archName = architecture === 'arm64' ? 'arm64' : architecture === 'x64' ? 'amd64' : null
  const key = osName && archName ? `${osName}-${archName}` : null
  if (!key || !ORAS_SHA256[key]) throw new Error(`ORAS ${ORAS_VERSION} is not pinned for ${platform}/${architecture}.`)
  const archive = `oras_${ORAS_VERSION}_${osName}_${archName}.tar.gz`
  return {
    archive,
    sha256: ORAS_SHA256[key],
    url: `https://github.com/oras-project/oras/releases/download/v${ORAS_VERSION}/${archive}`,
  }
}

export async function ensurePinnedOras(paths) {
  const distribution = orasDistribution()
  const installDir = path.join(paths.toolsDir, `oras-${ORAS_VERSION}-${process.platform}-${process.arch}`)
  const binary = path.join(installDir, 'oras')
  try {
    const existing = await run([binary, 'version'], { capture: true, log: false, allowFailure: true })
    if (existing.exitCode === 0 && existing.stdout.includes(`Version:        ${ORAS_VERSION}`)) return binary
  } catch {}

  await fs.mkdir(installDir, { recursive: true, mode: 0o700 })
  const temporary = path.join(os.tmpdir(), `${distribution.archive}.${process.pid}`)
  await run(['curl', '--fail', '--silent', '--show-error', '--location', '--output', temporary, distribution.url])
  const actual = createHash('sha256').update(await fs.readFile(temporary)).digest('hex')
  if (actual !== distribution.sha256) {
    await fs.rm(temporary, { force: true })
    throw new Error(`ORAS ${ORAS_VERSION} checksum verification failed.`)
  }
  await run(['tar', '-xzf', temporary, '-C', installDir, 'oras'])
  await fs.rm(temporary, { force: true })
  await fs.chmod(binary, 0o700)
  const installed = await run([binary, 'version'], { capture: true, log: false })
  if (!installed.stdout.includes(`Version:        ${ORAS_VERSION}`)) throw new Error('Pinned ORAS installation is invalid.')
  return binary
}
