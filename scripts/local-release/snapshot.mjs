import fs from 'node:fs/promises'
import path from 'node:path'
import { run } from './process.mjs'

const REMOTE_HELPER = 'remote-snapshot.mjs'

async function cloneDirectory(source, target) {
  await fs.rm(target, { recursive: true, force: true })
  if (await fs.stat(source).then(() => true, () => false)) {
    await fs.cp(source, target, { recursive: true, mode: fs.constants.COPYFILE_FICLONE })
  } else {
    await fs.mkdir(target, { recursive: true, mode: 0o700 })
  }
}

export async function verifySnapshotManifest(directory) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'snapshot-manifest.json'), 'utf8'))
  if (manifest?.version !== 1 || !Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('Live snapshot manifest is invalid.')
  }
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(entry.path) || entry.path.includes('..')) {
      throw new Error('Live snapshot manifest contains an unsafe path.')
    }
    const file = path.join(directory, entry.path)
    const stat = await fs.stat(file)
    if (!stat.isFile() || stat.size !== entry.bytes) throw new Error(`Live snapshot file ${entry.path} failed size validation.`)
    const { stdout } = await run(['shasum', '-a', '256', file], { capture: true, log: false })
    if (stdout.split(/\s+/)[0] !== entry.sha256) throw new Error(`Live snapshot file ${entry.path} failed hash validation.`)
  }
  return manifest
}

export async function createRemoteSnapshot(config, paths, { root } = {}) {
  const token = `${Date.now()}-${process.pid}`
  const remoteRoot = `/tmp/homelab-inventory-release-${token}`
  const remoteHelper = `${remoteRoot}/${REMOTE_HELPER}`
  await run(['ssh', config.host, 'mkdir', '-m', '700', '-p', remoteRoot])
  try {
    await run(['scp', path.join(root, 'scripts', 'local-release', REMOTE_HELPER), `${config.host}:${remoteHelper}`])
    const command = [
      'set -euo pipefail',
      `cd ${JSON.stringify(config.stackDir)}`,
      `cid="$(docker compose ps -q ${JSON.stringify(config.service)})"`,
      'test -n "$cid"',
      `docker cp ${JSON.stringify(remoteHelper)} "$cid:/tmp/${REMOTE_HELPER}"`,
      `docker exec "$cid" bun "/tmp/${REMOTE_HELPER}" /data /tmp/release-snapshot`,
      `docker cp "$cid:/tmp/release-snapshot/." ${JSON.stringify(`${remoteRoot}/snapshot`)}`,
      `docker exec "$cid" bun -e 'const fs=await import("node:fs/promises"); await fs.rm("/tmp/release-snapshot",{recursive:true,force:true})'`,
      `chmod -R u+rwX,go-rwx ${JSON.stringify(`${remoteRoot}/snapshot`)}`,
    ].join('; ')
    await run(['ssh', config.host, command])
    await cloneDirectory(paths.currentDataDir, paths.incomingDataDir)
    await run([
      'rsync', '-a', '--delete', '--chmod=Du=rwx,Dgo=,Fu=rw,Fgo=',
      `${config.host}:${remoteRoot}/snapshot/`, `${paths.incomingDataDir}/`,
    ])
    return await verifySnapshotManifest(paths.incomingDataDir)
  } finally {
    await run(['ssh', config.host, 'rm', '-rf', remoteRoot], { allowFailure: true, log: false })
  }
}

export async function activateIncomingData(paths) {
  const nextPrevious = `${paths.previousDataDir}.${process.pid}.old`
  await fs.rm(nextPrevious, { recursive: true, force: true })
  if (await fs.stat(paths.previousDataDir).then(() => true, () => false)) {
    await fs.rename(paths.previousDataDir, nextPrevious)
  }
  if (await fs.stat(paths.currentDataDir).then(() => true, () => false)) {
    await fs.rename(paths.currentDataDir, paths.previousDataDir)
  }
  try {
    await fs.rename(paths.incomingDataDir, paths.currentDataDir)
    await fs.rm(nextPrevious, { recursive: true, force: true })
  } catch (error) {
    if (await fs.stat(paths.previousDataDir).then(() => true, () => false)) {
      await fs.rename(paths.previousDataDir, paths.currentDataDir)
    }
    if (await fs.stat(nextPrevious).then(() => true, () => false)) {
      await fs.rename(nextPrevious, paths.previousDataDir)
    }
    throw error
  }
}
