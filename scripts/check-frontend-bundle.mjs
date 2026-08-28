import { readFileSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const DEFAULT_BUNDLE_LIMITS = Object.freeze({
  maxInitialBytes: 500 * 1024,
  preferredInitialGzipBytes: 220 * 1024,
  maxAsyncBytes: 500 * 1024,
  maxJavaScriptChunks: 105,
  routeGraphs: {
    systems: {
      roots: ['src/App.tsx'],
      maxRequests: 48,
      maxGzipBytes: 350 * 1024,
    },
    canvas: {
      roots: [
        'src/App.tsx',
        'workbench-canvas',
        'dnd-workspace',
        'inventory-sidebar',
      ],
      maxRequests: 58,
      maxGzipBytes: 450 * 1024,
    },
  },
  requiredLazyLabels: [
    'workbench-canvas',
    'dnd-workspace',
    'inventory-sidebar',
    'mobile-inventory',
    'inspector',
    'settings',
    'inventory-item',
    'onboarding',
  ],
})

function javascriptEntries(manifest) {
  return Object.entries(manifest).filter(([, entry]) => entry.file?.endsWith('.js'))
}

function findEntryKey(manifest) {
  const entry = Object.entries(manifest).find(([, value]) => value.isEntry)
  if (!entry) throw new Error('The Vite manifest does not contain an entry chunk.')
  return entry[0]
}

function collectStaticImports(manifest, key, collected = new Set()) {
  if (collected.has(key)) return collected
  const entry = manifest[key]
  if (!entry) throw new Error(`Manifest import ${key} does not exist.`)

  collected.add(key)
  for (const importedKey of entry.imports ?? []) {
    collectStaticImports(manifest, importedKey, collected)
  }
  return collected
}

function collectDynamicEntryKeys(manifest) {
  const dynamicKeys = new Set()
  for (const entry of Object.values(manifest)) {
    for (const dynamicKey of entry.dynamicImports ?? []) dynamicKeys.add(dynamicKey)
  }
  return dynamicKeys
}

function fileMeasurement(assetsRoot, file) {
  const absolutePath = path.join(assetsRoot, file)
  const contents = readFileSync(absolutePath)
  return {
    file,
    bytes: statSync(absolutePath).size,
    gzipBytes: gzipSync(contents).byteLength,
  }
}

function manifestKeyForLabel(manifest, label) {
  const normalized = label.toLowerCase()
  const matches = javascriptEntries(manifest).filter(([key, entry]) => (
    `${key} ${entry.file}`.toLowerCase().includes(normalized)
  ))
  if (matches.length !== 1) {
    throw new Error(`Route graph root ${label} matched ${matches.length} manifest entries.`)
  }
  return matches[0][0]
}

function routeGraph(manifest, assetsRoot, entryKey, definition) {
  const keys = collectStaticImports(manifest, entryKey)
  for (const label of definition.roots) {
    collectStaticImports(manifest, manifestKeyForLabel(manifest, label), keys)
  }
  const chunks = javascriptEntries(manifest)
    .filter(([key]) => keys.has(key))
    .map(([, entry]) => fileMeasurement(assetsRoot, entry.file))
  return {
    requests: chunks.length,
    bytes: chunks.reduce((sum, chunk) => sum + chunk.bytes, 0),
    gzipBytes: chunks.reduce((sum, chunk) => sum + chunk.gzipBytes, 0),
    chunks,
  }
}

export function analyzeFrontendBundle({ manifest, assetsRoot, limits = DEFAULT_BUNDLE_LIMITS }) {
  const entryKey = findEntryKey(manifest)
  const initialKeys = collectStaticImports(manifest, entryKey)
  const dynamicKeys = collectDynamicEntryKeys(manifest)
  const jsEntries = javascriptEntries(manifest)

  const initial = jsEntries
    .filter(([key]) => initialKeys.has(key))
    .map(([, entry]) => fileMeasurement(assetsRoot, entry.file))
  const asyncChunks = jsEntries
    .filter(([key]) => dynamicKeys.has(key) && !initialKeys.has(key))
    .map(([key, entry]) => ({ key, ...fileMeasurement(assetsRoot, entry.file) }))

  const initialBytes = initial.reduce((sum, entry) => sum + entry.bytes, 0)
  const initialGzipBytes = initial.reduce((sum, entry) => sum + entry.gzipBytes, 0)
  const errors = []
  const warnings = []
  const routeGraphs = {}

  if (jsEntries.length > limits.maxJavaScriptChunks) {
    errors.push(`JavaScript chunk count is ${jsEntries.length}; limit is ${limits.maxJavaScriptChunks}.`)
  }

  if (initialBytes > limits.maxInitialBytes) {
    errors.push(`Initial JavaScript is ${initialBytes} bytes; limit is ${limits.maxInitialBytes} bytes.`)
  }
  if (initialGzipBytes > limits.preferredInitialGzipBytes) {
    warnings.push(`Initial gzip JavaScript is ${initialGzipBytes} bytes; preferred target is ${limits.preferredInitialGzipBytes} bytes.`)
  }

  for (const chunk of asyncChunks) {
    if (chunk.bytes > limits.maxAsyncBytes) {
      errors.push(`Async chunk ${chunk.file} is ${chunk.bytes} bytes; limit is ${limits.maxAsyncBytes} bytes.`)
    }
  }

  const lazySearchValues = asyncChunks.map((chunk) => `${chunk.key} ${chunk.file}`.toLowerCase())
  const missingLazyLabels = limits.requiredLazyLabels.filter(
    (label) => !lazySearchValues.some((value) => value.includes(label.toLowerCase())),
  )
  if (missingLazyLabels.length > 0) {
    errors.push(`Missing required lazy chunks: ${missingLazyLabels.join(', ')}.`)
  }

  for (const [name, definition] of Object.entries(limits.routeGraphs ?? {})) {
    try {
      const graph = routeGraph(manifest, assetsRoot, entryKey, definition)
      routeGraphs[name] = graph
      if (graph.requests > definition.maxRequests) {
        errors.push(`${name} route graph requires ${graph.requests} JavaScript requests; limit is ${definition.maxRequests}.`)
      }
      if (graph.gzipBytes > definition.maxGzipBytes) {
        errors.push(`${name} route graph is ${graph.gzipBytes} gzip bytes; limit is ${definition.maxGzipBytes} bytes.`)
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }

  return {
    entryKey,
    initial,
    asyncChunks,
    initialBytes,
    initialGzipBytes,
    missingLazyLabels,
    javascriptChunks: jsEntries.length,
    routeGraphs,
    errors,
    warnings,
  }
}

function formatKilobytes(bytes) {
  return `${(bytes / 1024).toFixed(2)} kB`
}

export function formatFrontendBundleReport(report) {
  const lines = [
    `Initial JavaScript: ${formatKilobytes(report.initialBytes)} raw / ${formatKilobytes(report.initialGzipBytes)} gzip`,
    `Initial chunks: ${report.initial.map((entry) => entry.file).join(', ')}`,
    `Async chunks: ${report.asyncChunks.length}`,
    `Total JavaScript chunks: ${report.javascriptChunks}`,
  ]

  for (const [name, graph] of Object.entries(report.routeGraphs)) {
    lines.push(`${name} route: ${graph.requests} requests / ${formatKilobytes(graph.bytes)} raw / ${formatKilobytes(graph.gzipBytes)} gzip`)
  }

  for (const warning of report.warnings) lines.push(`WARNING: ${warning}`)
  for (const error of report.errors) lines.push(`ERROR: ${error}`)
  return lines.join('\n')
}

export function checkFrontendBundle({
  manifestPath = path.resolve('dist/.vite/manifest.json'),
  assetsRoot = path.resolve('dist'),
  limits = DEFAULT_BUNDLE_LIMITS,
} = {}) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return analyzeFrontendBundle({ manifest, assetsRoot, limits })
}

const scriptPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null
if (scriptPath === import.meta.url) {
  try {
    const report = checkFrontendBundle()
    console.log(formatFrontendBundleReport(report))
    if (report.errors.length > 0) process.exitCode = 1
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

export const __filename = fileURLToPath(import.meta.url)
