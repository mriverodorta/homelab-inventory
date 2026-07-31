import fs from 'node:fs/promises'
import path from 'node:path'

const requiredFiles = [
  'server/engine/generated/homelab_engine.wasm',
  'shared/engine/protocol.mjs',
  'shared/engine/wasm-runtime.mjs',
]

const forbiddenDirectoryNames = new Set(['data-wasm', 'rust', 'target'])
const forbiddenFile = /(?:^Cargo\.toml$|\.rs$|(?:^|\.)test\.[^.]+$|(?:^|\.)spec\.[^.]+$)/u

async function exists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

const runtimeModuleExtensions = ['.ts', '.mts', '.js', '.mjs', '.cjs', '.json']

async function isFile(filePath) {
  try {
    return (await fs.stat(filePath)).isFile()
  } catch {
    return false
  }
}

async function resolveRuntimeImport(importedPath) {
  if (await isFile(importedPath)) return importedPath

  for (const extension of runtimeModuleExtensions) {
    const candidate = `${importedPath}${extension}`
    if (await isFile(candidate)) return candidate
  }

  for (const extension of runtimeModuleExtensions) {
    const candidate = path.join(importedPath, `index${extension}`)
    if (await isFile(candidate)) return candidate
  }

  return null
}

async function findForbidden(root, directory = root) {
  const violations = []
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue
    const entryPath = path.join(directory, entry.name)
    const relative = path.relative(root, entryPath)
    if (entry.isDirectory()) {
      if (forbiddenDirectoryNames.has(entry.name)) violations.push(relative)
      else violations.push(...await findForbidden(root, entryPath))
    } else if (entry.isFile() && forbiddenFile.test(entry.name)) {
      violations.push(relative)
    }
  }
  return violations
}

async function findBrowserWasm(root) {
  const assetsDir = path.join(root, 'dist', 'assets')
  if (!(await exists(assetsDir))) return false
  return (await fs.readdir(assetsDir)).some((name) => name.endsWith('.wasm'))
}

async function findMissingServerImports(root) {
  const entry = path.join(root, 'server', 'index.mjs')
  if (!(await exists(entry))) return []

  const missing = []
  const pending = [entry]
  const visited = new Set()
  const importPattern = /(?:from\s+|import\s*\(\s*|import\s+)["'](\.{1,2}\/[^"']+)["']/gu

  while (pending.length > 0) {
    const current = pending.pop()
    if (visited.has(current)) continue
    visited.add(current)

    const source = await fs.readFile(current, 'utf8')
    for (const match of source.matchAll(importPattern)) {
      const imported = path.resolve(path.dirname(current), match[1])
      const resolved = await resolveRuntimeImport(imported)
      if (!resolved) {
        missing.push(path.relative(root, imported))
      } else if (!visited.has(resolved)) {
        pending.push(resolved)
      }
    }
  }

  return [...new Set(missing)].sort()
}

export async function verifyWasmRuntime(root) {
  const missing = []
  for (const file of requiredFiles) {
    if (!(await exists(path.join(root, file)))) missing.push(file)
  }
  if (!(await findBrowserWasm(root))) missing.push('dist/assets/*.wasm')
  missing.push(...await findMissingServerImports(root))
  const forbidden = await findForbidden(root)
  if (missing.length > 0 || forbidden.length > 0) {
    throw new Error([
      missing.length > 0 ? `Missing runtime files: ${missing.join(', ')}` : '',
      forbidden.length > 0 ? `Forbidden runtime content: ${forbidden.join(', ')}` : '',
    ].filter(Boolean).join('\n'))
  }
  return { ok: true, root }
}

if (import.meta.main) {
  const root = path.resolve(process.argv[2] ?? '.')
  console.log(JSON.stringify(await verifyWasmRuntime(root)))
}
