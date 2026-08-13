#!/usr/bin/env bun
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { Database } from 'bun:sqlite'

const [sourceDir, outputDir] = process.argv.slice(2)
if (!sourceDir || !outputDir) throw new Error('Usage: bun remote-snapshot.mjs <source-data-dir> <output-dir>')

const SQLITE_FILES = [
  'databases/homelab-inventory.sqlite',
  'databases/catalog.sqlite',
  'databases/telemetry.sqlite',
  'telemetry/telemetry.sqlite',
]
const SUPPORT_FILES = [
  'meta.json',
  'server-specs-project.json',
  'databases/persistence-engine.json',
  'catalog/active-generation.json',
]
const SUPPORT_DIRECTORIES = ['stores', 'catalog/generations']

async function exists(file) {
  try { await fs.access(file); return true } catch { return false }
}

function safeRelative(relative) {
  return relative && !path.isAbsolute(relative) && !relative.split(path.sep).includes('..')
}

async function writeDatabase(relative) {
  const source = path.join(sourceDir, relative)
  if (!await exists(source)) return null
  const database = new Database(source, { readonly: true, strict: true })
  try {
    const quickCheck = database.query('PRAGMA quick_check').get()?.quick_check
    if (quickCheck !== 'ok') throw new Error(`${relative} failed SQLite quick_check.`)
    const output = path.join(outputDir, relative)
    await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
    await fs.rm(output, { force: true })
    database.run('VACUUM INTO ?', [output])
    await fs.chmod(output, 0o600)
    return relative
  } finally {
    database.close(false)
  }
}

async function copyFile(relative) {
  if (!safeRelative(relative) || relative.endsWith('-wal') || relative.endsWith('-shm') || relative.endsWith('.tmp')) return null
  const source = path.join(sourceDir, relative)
  if (!await exists(source)) return null
  const output = path.join(outputDir, relative)
  await fs.mkdir(path.dirname(output), { recursive: true, mode: 0o700 })
  await fs.copyFile(source, output)
  await fs.chmod(output, 0o600)
  return relative
}

async function copyDirectory(relative) {
  const source = path.join(sourceDir, relative)
  if (!await exists(source)) return []
  const copied = []
  for (const entry of await fs.readdir(source, { withFileTypes: true })) {
    const child = path.join(relative, entry.name)
    if (entry.isDirectory()) copied.push(...await copyDirectory(child))
    else if (entry.isFile()) {
      if (entry.name === 'catalog.sqlite') copied.push(await writeDatabase(child))
      else copied.push(await copyFile(child))
    }
  }
  return copied.filter(Boolean)
}

async function digest(relative) {
  const body = await fs.readFile(path.join(outputDir, relative))
  return { path: relative, bytes: body.byteLength, sha256: createHash('sha256').update(body).digest('hex') }
}

await fs.rm(outputDir, { recursive: true, force: true })
await fs.mkdir(outputDir, { recursive: true, mode: 0o700 })
const files = (await Promise.all(SQLITE_FILES.map(writeDatabase))).filter(Boolean)
files.push(...(await Promise.all(SUPPORT_FILES.map(copyFile))).filter(Boolean))
for (const directory of SUPPORT_DIRECTORIES) files.push(...await copyDirectory(directory))
files.sort()
const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  files: await Promise.all(files.map(digest)),
}
await fs.writeFile(path.join(outputDir, 'snapshot-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
console.log(JSON.stringify({ files: files.length, createdAt: manifest.createdAt }))
