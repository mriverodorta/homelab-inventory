import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CATALOG_INDEX_SCHEMA_VERSION } from './catalog-index-contract.mjs'

const runtimeImport = new Function('specifier', 'return import(specifier)')

async function openCatalogIndex(filePath) {
  const moduleUrl = new URL('./catalog-index.mjs', import.meta.url).href
  const { CatalogIndex } = await runtimeImport(moduleUrl)
  return new CatalogIndex(filePath)
}

export const CATALOG_RECEIPT_VERSION = 1
const FILE_KEYS = ['snapshot', 'digest', 'facets', 'index']

async function regularFileDescriptor(filePath) {
  const stats = await fs.lstat(filePath)
  if (!stats.isFile()) throw new Error('Catalog generation contains a non-regular artifact.')
  const handle = await fs.open(filePath, 'r')
  try {
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(256 * 1024)
    let position = 0
    while (position < stats.size) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, stats.size - position), position)
      if (bytesRead === 0) break
      hash.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    if (position !== stats.size) throw new Error('Catalog artifact changed while it was being verified.')
    return { sizeBytes: stats.size, sha256: hash.digest('hex') }
  } finally {
    await handle.close()
  }
}

async function artifactDescriptors(paths) {
  const entries = []
  for (const key of FILE_KEYS) {
    const filePath = paths[key]
    if (!filePath) continue
    try {
      entries.push([key, await regularFileDescriptor(filePath)])
    } catch (error) {
      if (key === 'facets' && error?.code === 'ENOENT') continue
      throw error
    }
  }
  return Object.fromEntries(entries)
}

function assertIdentity(receipt, identity) {
  if (receipt.version !== CATALOG_RECEIPT_VERSION) throw new Error('Catalog verification receipt version is unsupported.')
  for (const key of [
    'revision',
    'digest',
    'catalogContractVersion',
    'fingerprintVersion',
    'indexSchemaVersion',
    'templateCount',
    'facetCategoryCount',
  ]) {
    if (receipt[key] !== identity[key]) throw new Error(`Catalog verification receipt ${key} does not match the active generation.`)
  }
}

async function durableAtomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  const temporary = `${filePath}.${process.pid}-${randomUUID()}.tmp`
  let handle
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(contents)
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600)
  } finally {
    await handle?.close().catch(() => {})
    await fs.rm(temporary, { force: true }).catch(() => {})
  }
}

export async function writeCatalogGenerationReceipt(paths, identity, { now = new Date() } = {}) {
  const receipt = {
    version: CATALOG_RECEIPT_VERSION,
    ...identity,
    indexSchemaVersion: CATALOG_INDEX_SCHEMA_VERSION,
    files: await artifactDescriptors(paths),
    verifiedAt: now.toISOString(),
  }
  await durableAtomicWrite(paths.receipt, `${JSON.stringify(receipt, null, 2)}\n`)
  return receipt
}

export async function verifyCatalogGenerationReceipt(paths, identity) {
  const receiptStats = await fs.lstat(paths.receipt)
  if (!receiptStats.isFile()) throw new Error('Catalog verification receipt is not a regular file.')
  const receipt = JSON.parse(await fs.readFile(paths.receipt, 'utf8'))
  assertIdentity(receipt, { ...identity, indexSchemaVersion: CATALOG_INDEX_SCHEMA_VERSION })
  const actual = await artifactDescriptors(paths)
  if (JSON.stringify(actual) !== JSON.stringify(receipt.files)) {
    throw new Error('Catalog generation artifacts do not match their verification receipt.')
  }
  const index = await openCatalogIndex(paths.index)
  const indexVerification = index.verifyRuntime({
    templateCount: receipt.templateCount,
    facetCategoryCount: receipt.facetCategoryCount,
  })
  return { receipt, index: indexVerification }
}
