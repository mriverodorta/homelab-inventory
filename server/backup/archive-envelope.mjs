import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import tar from 'tar-stream'
import {
  BACKUP_ARCHIVE_FORMAT_VERSION,
  BACKUP_ARCHIVE_MAGIC,
} from '../../shared/backup/contract.mjs'
import { assertSafeArchivePath, createEncryptionSalt, deriveArchiveKey, sha256 } from './archive-security.mjs'

const MAX_HEADER_BYTES = 4096
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024
const MAX_ENTRY_BYTES = 256 * 1024 * 1024
const MAX_FILES = 4096
const TAG_BYTES = 16

function collectStream(stream, maximum = MAX_ARCHIVE_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    stream.on('data', (chunk) => {
      total += chunk.length
      if (total > maximum) {
        stream.destroy(new Error('Backup archive exceeds the allowed size.'))
        return
      }
      chunks.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks, total)))
  })
}

async function createTar(entries) {
  const pack = tar.pack()
  const result = collectStream(pack, MAX_EXPANDED_BYTES)
  for (const entry of entries) {
    assertSafeArchivePath(entry.name)
    const body = Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(entry.body)
    if (body.length > MAX_ENTRY_BYTES) throw new Error('Backup archive entry exceeds the allowed size.')
    pack.entry({ name: entry.name, size: body.length, mode: 0o600, type: 'file' }, body)
  }
  pack.finalize()
  return result
}

function encodeHeader(header) {
  const encoded = Buffer.from(JSON.stringify(header))
  if (encoded.length > MAX_HEADER_BYTES) throw new Error('Backup archive header is too large.')
  const prefix = Buffer.alloc(BACKUP_ARCHIVE_MAGIC.length + 4)
  prefix.write(BACKUP_ARCHIVE_MAGIC, 0, 'ascii')
  prefix.writeUInt32BE(encoded.length, BACKUP_ARCHIVE_MAGIC.length)
  return Buffer.concat([prefix, encoded])
}

function decodeEnvelope(archive) {
  if (!Buffer.isBuffer(archive) || archive.length > MAX_ARCHIVE_BYTES) throw new Error('Backup archive size is invalid.')
  const prefixBytes = BACKUP_ARCHIVE_MAGIC.length + 4
  if (archive.length < prefixBytes || archive.subarray(0, BACKUP_ARCHIVE_MAGIC.length).toString('ascii') !== BACKUP_ARCHIVE_MAGIC) {
    throw new Error('Backup archive signature is invalid.')
  }
  const headerBytes = archive.readUInt32BE(BACKUP_ARCHIVE_MAGIC.length)
  if (headerBytes < 2 || headerBytes > MAX_HEADER_BYTES || archive.length < prefixBytes + headerBytes) {
    throw new Error('Backup archive header is invalid.')
  }
  let header
  try { header = JSON.parse(archive.subarray(prefixBytes, prefixBytes + headerBytes).toString('utf8')) } catch { throw new Error('Backup archive header is invalid.') }
  if (header?.formatVersion !== BACKUP_ARCHIVE_FORMAT_VERSION || !['none', 'aes-256-gcm'].includes(header?.encryption)) {
    throw new Error('Backup archive format is unsupported.')
  }
  return { header, authenticatedHeader: archive.subarray(0, prefixBytes + headerBytes), body: archive.subarray(prefixBytes + headerBytes) }
}

export async function createArchiveBuffer({ manifest, files, passphrase = null }) {
  const manifestBody = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
  const tarBody = await createTar([{ name: 'manifest.json', body: manifestBody }, ...files])
  const compressed = gzipSync(tarBody, { level: 9 })
  if (compressed.length > MAX_ARCHIVE_BYTES) throw new Error('Backup archive exceeds the allowed size.')

  if (passphrase === null) {
    const header = encodeHeader({ formatVersion: BACKUP_ARCHIVE_FORMAT_VERSION, encryption: 'none', payloadBytes: compressed.length })
    return Buffer.concat([header, compressed])
  }

  const salt = createEncryptionSalt()
  const iv = randomBytes(12)
  const header = encodeHeader({
    formatVersion: BACKUP_ARCHIVE_FORMAT_VERSION,
    encryption: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    payloadBytes: compressed.length,
  })
  const key = await deriveArchiveKey(passphrase, salt)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(header)
    const encrypted = Buffer.concat([cipher.update(compressed), cipher.final()])
    return Buffer.concat([header, encrypted, cipher.getAuthTag()])
  } finally {
    key.fill(0)
  }
}

async function decryptEnvelope(envelope, passphrase) {
  const { header, authenticatedHeader, body } = envelope
  if (header.encryption === 'none') {
    if (body.length !== header.payloadBytes) throw new Error('Backup archive payload is truncated.')
    return body
  }
  if (typeof passphrase !== 'string') throw new Error('Backup passphrase is required.')
  if (body.length < TAG_BYTES) throw new Error('Backup archive payload is truncated.')
  const salt = Buffer.from(header.salt ?? '', 'base64')
  const iv = Buffer.from(header.iv ?? '', 'base64')
  if (salt.length !== 16 || iv.length !== 12 || body.length - TAG_BYTES !== header.payloadBytes) {
    throw new Error('Backup archive encryption metadata is invalid.')
  }
  const key = await deriveArchiveKey(passphrase, salt)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAAD(authenticatedHeader)
    decipher.setAuthTag(body.subarray(body.length - TAG_BYTES))
    try {
      return Buffer.concat([decipher.update(body.subarray(0, -TAG_BYTES)), decipher.final()])
    } catch {
      throw new Error('Backup passphrase is incorrect or the archive is damaged.')
    }
  } finally {
    key.fill(0)
  }
}

async function extractTar(buffer) {
  const extract = tar.extract()
  const files = new Map()
  let total = 0
  let count = 0
  let failure = null
  extract.on('entry', (header, stream, next) => {
    try {
      assertSafeArchivePath(header.name)
      if (header.type !== 'file') throw new Error('Backup archive contains an unsupported entry type.')
      if (files.has(header.name)) throw new Error('Backup archive contains duplicate entries.')
      if (++count > MAX_FILES || header.size > MAX_ENTRY_BYTES) throw new Error('Backup archive exceeds extraction limits.')
    } catch (error) {
      failure = error
      stream.resume()
      next()
      return
    }
    const chunks = []
    let entryBytes = 0
    stream.on('data', (chunk) => {
      entryBytes += chunk.length
      total += chunk.length
      if (entryBytes > MAX_ENTRY_BYTES || total > MAX_EXPANDED_BYTES) failure ??= new Error('Backup archive exceeds extraction limits.')
      chunks.push(chunk)
    })
    stream.on('end', () => {
      if (!failure) files.set(header.name, Buffer.concat(chunks, entryBytes))
      next()
    })
    stream.on('error', (error) => { failure ??= error; next() })
  })
  const done = new Promise((resolve, reject) => {
    extract.on('finish', resolve)
    extract.on('error', reject)
  })
  extract.end(buffer)
  await done
  if (failure) throw failure
  return files
}

export async function inspectArchiveBuffer(archive, { passphrase = null } = {}) {
  const envelope = decodeEnvelope(archive)
  const compressed = await decryptEnvelope(envelope, passphrase)
  let tarBody
  try { tarBody = gunzipSync(compressed, { maxOutputLength: MAX_EXPANDED_BYTES }) } catch { throw new Error('Backup archive compression payload is invalid.') }
  const files = await extractTar(tarBody)
  const first = files.keys().next().value
  if (first !== 'manifest.json') throw new Error('Backup archive manifest must be the first entry.')
  let manifest
  try { manifest = JSON.parse(files.get('manifest.json').toString('utf8')) } catch { throw new Error('Backup archive manifest is invalid.') }
  const expectedFiles = manifest?.files
  if (!Array.isArray(expectedFiles)) throw new Error('Backup archive manifest files are invalid.')
  const expectedNames = new Set(['manifest.json'])
  for (const record of expectedFiles) {
    assertSafeArchivePath(record?.path)
    if (expectedNames.has(record.path)) throw new Error('Backup archive manifest contains duplicate files.')
    expectedNames.add(record.path)
    const content = files.get(record.path)
    if (!content || content.length !== record.sizeBytes || sha256(content) !== record.sha256) {
      throw new Error(`Backup archive file ${record.path} failed integrity verification.`)
    }
  }
  if (files.size !== expectedNames.size || [...files.keys()].some((name) => !expectedNames.has(name))) {
    throw new Error('Backup archive contains files not declared by the manifest.')
  }
  return { manifest, files, encrypted: envelope.header.encryption !== 'none' }
}
