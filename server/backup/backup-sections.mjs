import fs from 'node:fs/promises'
import path from 'node:path'
import { normalizeBackupSections } from '../../shared/backup/contract.mjs'
import { createRegistryStore, normalizeRegistryStore } from '../registry/model.mjs'

const JSON_SECTION_FILES = Object.freeze({
  inventory: 'sections/inventory.json',
  project: 'sections/project.json',
  routingCache: 'sections/routing-cache.json',
  registryConfiguration: 'sections/registry-configuration.json',
  registryEnrollment: 'sections/registry-enrollment.json',
  authentication: 'sections/authentication.json',
  catalogState: 'sections/catalog-state.json',
  agents: 'sections/agents.json',
  agentTelemetry: 'sections/agent-telemetry.json',
  applicationMetadata: 'sections/application-metadata.json',
})
const ENROLLMENT_FILE_NAMES = new Set([
  'installation-ed25519.pem',
  'installation-credentials.json',
])

async function pathExists(filePath) {
  try { await fs.access(filePath); return true } catch { return false }
}

function jsonEntry(name, value) {
  return { name, body: Buffer.from(`${JSON.stringify(value, null, 2)}\n`) }
}

async function collectFiles(directory, prefix, { exclude = () => false } = {}) {
  if (!await pathExists(directory)) return []
  const entries = []
  for (const dirent of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (exclude(dirent.name)) continue
    const absolute = path.join(directory, dirent.name)
    const relative = `${prefix}/${dirent.name}`
    if (dirent.isDirectory()) entries.push(...await collectFiles(absolute, relative, { exclude }))
    else if (dirent.isFile()) entries.push({ name: relative, body: await fs.readFile(absolute) })
  }
  return entries
}

function registryConfiguration(registry) {
  return { ...structuredClone(registry), installationIdentity: null }
}

export async function collectBackupSections({ store, sections, demo = false }) {
  const selected = normalizeBackupSections(sections, { demo })
  const snapshot = await store.snapshotStores()
  const files = []
  for (const section of selected) {
    if (section === 'inventory') files.push(jsonEntry(JSON_SECTION_FILES.inventory, snapshot.inventory))
    if (section === 'project') files.push(jsonEntry(JSON_SECTION_FILES.project, snapshot.project))
    if (section === 'routingCache') files.push(jsonEntry(JSON_SECTION_FILES.routingCache, snapshot.routingCache))
    if (section === 'registryConfiguration') files.push(jsonEntry(JSON_SECTION_FILES.registryConfiguration, registryConfiguration(snapshot.registry)))
    if (section === 'agents') files.push(jsonEntry(JSON_SECTION_FILES.agents, snapshot.agents))
    if (section === 'agentTelemetry') files.push(jsonEntry(JSON_SECTION_FILES.agentTelemetry, snapshot.agentStatus))
    if (section === 'authentication') files.push(jsonEntry(JSON_SECTION_FILES.authentication, snapshot.authentication))
    if (section === 'applicationMetadata') {
      files.push(jsonEntry(JSON_SECTION_FILES.applicationMetadata, {
        meta: snapshot.meta,
        schedule: snapshot.backupManagement.schedule,
      }))
    }
    if (section === 'registryEnrollment') {
      const enrollmentFiles = []
      const registryDir = path.join(store.dataDir, 'registry')
      for (const name of ['installation-ed25519.pem', 'installation-credentials.json']) {
        const absolute = path.join(registryDir, name)
        if (await pathExists(absolute)) enrollmentFiles.push({ name: `registry/${name}`, body: await fs.readFile(absolute) })
      }
      files.push(jsonEntry(JSON_SECTION_FILES.registryEnrollment, {
        installationIdentity: snapshot.registry.installationIdentity,
        files: enrollmentFiles.map((entry) => entry.name),
      }), ...enrollmentFiles)
    }
    if (section === 'catalogState') {
      const catalogDir = path.join(store.dataDir, 'catalog')
      const catalogFiles = await collectFiles(catalogDir, 'catalog', {
        exclude: (name) => name.endsWith('.tmp'),
      })
      files.push(jsonEntry(JSON_SECTION_FILES.catalogState, {
        files: catalogFiles.map((entry) => entry.name),
      }), ...catalogFiles)
    }
  }
  return { sections: selected, files }
}

function parseJson(files, name) {
  const value = files.get(name)
  if (!value) throw new Error(`Backup section file ${name} is missing.`)
  try { return JSON.parse(value.toString('utf8')) } catch { throw new Error(`Backup section file ${name} is invalid.`) }
}

export function materializeBackupSections({ files, sections, currentStores }) {
  const selected = normalizeBackupSections(sections)
  const replacements = {}
  if (selected.includes('inventory')) replacements.inventory = parseJson(files, JSON_SECTION_FILES.inventory)
  if (selected.includes('project')) replacements.project = parseJson(files, JSON_SECTION_FILES.project)
  if (selected.includes('routingCache')) replacements.routingCache = parseJson(files, JSON_SECTION_FILES.routingCache)
  if (selected.includes('agents')) replacements.agents = parseJson(files, JSON_SECTION_FILES.agents)
  if (selected.includes('agentTelemetry')) replacements.agentStatus = parseJson(files, JSON_SECTION_FILES.agentTelemetry)
  if (selected.includes('authentication')) replacements.authentication = parseJson(files, JSON_SECTION_FILES.authentication)

  let registry = structuredClone(currentStores.registry)
  if (selected.includes('registryConfiguration')) {
    const configuration = parseJson(files, JSON_SECTION_FILES.registryConfiguration)
    registry = { ...configuration, installationIdentity: registry.installationIdentity }
  }
  if (selected.includes('registryEnrollment')) {
    const enrollment = parseJson(files, JSON_SECTION_FILES.registryEnrollment)
    registry.installationIdentity = enrollment.installationIdentity ?? null
  }
  if (selected.includes('registryConfiguration') || selected.includes('registryEnrollment')) {
    replacements.registry = normalizeRegistryStore({ ...createRegistryStore(), ...registry })
  }
  if (selected.includes('applicationMetadata')) {
    const metadata = parseJson(files, JSON_SECTION_FILES.applicationMetadata)
    replacements.meta = metadata.meta
    replacements.backupManagement = {
      ...structuredClone(currentStores.backupManagement),
      schedule: metadata.schedule,
      operation: null,
    }
  }
  return replacements
}

export function catalogFilesFromArchive(files) {
  return [...files.entries()]
    .filter(([name]) => name.startsWith('catalog/'))
    .map(([name, body]) => ({ relativePath: name.slice('catalog/'.length), body }))
}

export function enrollmentFilesFromArchive(files) {
  return [...files.entries()]
    .filter(([name]) => name.startsWith('registry/') && ENROLLMENT_FILE_NAMES.has(name.slice('registry/'.length)))
    .map(([name, body]) => ({ relativePath: name.slice('registry/'.length), body }))
}

export { JSON_SECTION_FILES }
