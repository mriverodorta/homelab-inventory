import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

async function collectFiles(root, relativePath) {
  const absolute = path.join(root, relativePath)
  const stat = await fs.lstat(absolute)
  if (stat.isSymbolicLink()) throw new Error(`Artifact fingerprint input cannot be a symbolic link: ${relativePath}`)
  if (stat.isFile()) return [relativePath]
  if (!stat.isDirectory()) throw new Error(`Unsupported artifact fingerprint input: ${relativePath}`)

  const entries = await fs.readdir(absolute, { withFileTypes: true })
  const files = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'target') continue
    files.push(...await collectFiles(root, path.join(relativePath, entry.name)))
  }
  return files
}

export async function computeArtifactFingerprint(root, contract) {
  if (!contract?.id || !Number.isSafeInteger(contract.version) || !Array.isArray(contract.inputs)) {
    throw new Error('Artifact fingerprint contract is invalid.')
  }
  const files = []
  for (const input of contract.inputs) files.push(...await collectFiles(root, input))
  const hash = createHash('sha256')
  hash.update(`${contract.id}\0${contract.version}\0`)
  for (const relativePath of [...new Set(files)].sort()) {
    hash.update(`${relativePath}\0`)
    hash.update(await fs.readFile(path.join(root, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}
