#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, relative } from 'node:path'

const repositoryRoot = resolve(process.cwd())
const packageDirectories = [
  'packages/catalog-protocol',
  'packages/share-contract',
  'packages/viewer-model',
  'packages/viewer-react',
]
const packageOrder = new Map([
  ['@homelab-inventory/catalog-protocol', 0],
  ['@homelab-inventory/share-contract', 0],
  ['@homelab-inventory/viewer-model', 1],
  ['@homelab-inventory/viewer-react', 2],
])
const expectedPackageVersions = new Map([
  ['@homelab-inventory/catalog-protocol', '0.1.1'],
  ['@homelab-inventory/share-contract', '0.1.0'],
  ['@homelab-inventory/viewer-model', '0.1.0'],
  ['@homelab-inventory/viewer-react', '0.1.0'],
])
const forbiddenFragments = [
  '.env',
  'credential',
  'data/',
  'screenshot',
  '.map',
  'server/',
  'editor/',
  'test/',
]

function shell(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

export function assertAllowedTarballFiles(packageName, files) {
  for (const file of files) {
    const normalized = file.replaceAll('\\', '/')
    const lower = normalized.toLowerCase()
    const allowlisted = normalized === 'package.json'
      || normalized === 'README.md'
      || normalized === 'LICENSE'
      || normalized.startsWith('src/')
    if (!allowlisted || forbiddenFragments.some((fragment) => lower.includes(fragment))) {
      throw new Error(`${packageName} tarball contains forbidden file ${normalized}.`)
    }
  }
}

export function assertDependencyDirection(dependenciesByPackage) {
  for (const [packageName, dependencies] of dependenciesByPackage) {
    const packagePosition = packageOrder.get(packageName)
    if (packagePosition === undefined) throw new Error(`Unknown public package ${packageName}.`)
    for (const dependencyName of Object.keys(dependencies)) {
      const dependencyPosition = packageOrder.get(dependencyName)
      if (dependencyPosition !== undefined && dependencyPosition >= packagePosition) {
        throw new Error(`${packageName} violates public package dependency direction with ${dependencyName}.`)
      }
    }
  }
}

export function assertPublicPackageManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('Public package manifest must be an object.')
  }
  if (!Array.isArray(manifest.files)
    || JSON.stringify(manifest.files) !== JSON.stringify(['src', 'README.md', 'LICENSE'])) {
    throw new Error(`${String(manifest.name)} must declare the explicit public file allowlist.`)
  }
  if (manifest.private === true) throw new Error(`${String(manifest.name)} must be public.`)
  if (manifest.publishConfig?.access !== 'public') {
    throw new Error(`${String(manifest.name)} must publish with public access.`)
  }
  const expectedVersion = expectedPackageVersions.get(manifest.name)
  if (expectedVersion === undefined) throw new Error(`Unexpected package name ${String(manifest.name)}.`)
  if (manifest.version !== expectedVersion) {
    throw new Error(`${manifest.name} must publish as version ${expectedVersion}.`)
  }
}

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return statSync(path).isFile() ? [path] : []
  })
}

function assertNoPrivateImports(packageDirectory) {
  const sourceDirectory = resolve(repositoryRoot, packageDirectory, 'src')
  for (const sourceFile of sourceFiles(sourceDirectory)) {
    const source = readFileSync(sourceFile, 'utf8')
    const forbiddenImport = source.match(/from\s+['"](?:@\/|\.\.\/\.\.\/\.\.\/src\/|[^'"]*(?:server|editor)[^'"]*)['"]/)
    if (forbiddenImport) {
      throw new Error(`${relative(repositoryRoot, sourceFile)} imports private application code: ${forbiddenImport[0]}.`)
    }
  }
}

function packageManifest(packageDirectory) {
  return JSON.parse(readFileSync(resolve(repositoryRoot, packageDirectory, 'package.json'), 'utf8'))
}

function dryRunPack(packageDirectory) {
  const output = shell('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
    cwd: resolve(repositoryRoot, packageDirectory),
  })
  const result = JSON.parse(output)
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error(`${packageDirectory} returned an invalid npm pack manifest.`)
  }
  return result[0]
}

function assertCleanPackages() {
  const status = shell('git', ['status', '--porcelain', '--', 'packages'])
  if (status) {
    throw new Error(`Public packages have uncommitted changes:\n${status}`)
  }
}

export function runPublicPackageAudit() {
  assertCleanPackages()
  const dependenciesByPackage = new Map()

  for (const packageDirectory of packageDirectories) {
    const manifest = packageManifest(packageDirectory)
    const pack = dryRunPack(packageDirectory)
    assertPublicPackageManifest(manifest)
    if (pack.name !== manifest.name || pack.version !== manifest.version) {
      throw new Error(`${manifest.name} npm pack identity does not match package.json.`)
    }
    assertAllowedTarballFiles(manifest.name, pack.files.map((file) => file.path))
    assertNoPrivateImports(packageDirectory)
    dependenciesByPackage.set(manifest.name, manifest.dependencies ?? {})
  }

  assertDependencyDirection(dependenciesByPackage)
  console.log('Public package publication contract verified.')
}

export const runSharePackageAudit = runPublicPackageAudit

if (import.meta.main) {
  try {
    runPublicPackageAudit()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
