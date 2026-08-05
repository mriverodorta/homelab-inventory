export const BACKUP_ARCHIVE_FORMAT_VERSION = 1
export const BACKUP_ARCHIVE_EXTENSION = '.hlibackup'
export const BACKUP_ARCHIVE_MAGIC = 'HLIBAK01'

export const BACKUP_SECTIONS = Object.freeze({
  inventory: {
    label: 'Inventory',
    description: 'Hardware records and component definitions.',
    sensitive: false,
  },
  project: {
    label: 'Project',
    description: 'Placements, assignments, connections, and project preferences.',
    sensitive: false,
  },
  routingCache: {
    label: 'Routing cache',
    description: 'Disposable calculated cable routes.',
    sensitive: false,
  },
  registryConfiguration: {
    label: 'Registry configuration',
    description: 'Registry mode, sources, links, templates, and delivery state.',
    sensitive: false,
  },
  registryEnrollment: {
    label: 'Registry enrollment',
    description: 'Stable installation UUID, signing key, and registry credentials.',
    sensitive: true,
  },
  authentication: {
    label: 'Authentication and access',
    description: 'User accounts, credentials, roles, invitations, sessions, and security history.',
    sensitive: true,
  },
  catalogState: {
    label: 'Catalog state',
    description: 'Verified signed catalog generations and active pointer.',
    sensitive: false,
  },
  agents: {
    label: 'Agents',
    description: 'Agent enrollments and device credentials.',
    sensitive: true,
  },
  agentTelemetry: {
    label: 'Agent telemetry',
    description: 'Latest agent-reported hardware and health state.',
    sensitive: true,
  },
  applicationMetadata: {
    label: 'Application metadata',
    description: 'Schema, onboarding, release state, and backup schedule.',
    sensitive: false,
  },
})

export const BACKUP_SECTION_NAMES = Object.freeze(Object.keys(BACKUP_SECTIONS))
export const COMPLETE_BACKUP_SECTIONS = Object.freeze([...BACKUP_SECTION_NAMES])
export const DEMO_BACKUP_SECTIONS = Object.freeze(['inventory', 'project'])

export const BACKUP_SECTION_DEPENDENCIES = Object.freeze({
  inventory: [],
  project: ['inventory'],
  routingCache: ['project'],
  registryConfiguration: ['inventory'],
  registryEnrollment: [],
  authentication: [],
  catalogState: [],
  agents: ['inventory'],
  agentTelemetry: ['agents'],
  applicationMetadata: [],
})

export function containsSensitiveSections(sections) {
  return sections.some((section) => BACKUP_SECTIONS[section]?.sensitive === true)
}

export function normalizeBackupSections(sections, { demo = false } = {}) {
  if (!Array.isArray(sections)) throw new Error('Backup sections must be an array.')
  const allowed = new Set(demo ? DEMO_BACKUP_SECTIONS : BACKUP_SECTION_NAMES)
  const normalized = [...new Set(sections)]
  if (normalized.length === 0 || normalized.some((section) => !allowed.has(section))) {
    throw new Error('Backup sections contain an unsupported selection.')
  }
  return BACKUP_SECTION_NAMES.filter((section) => normalized.includes(section))
}

export function assertBackupManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Backup manifest must be an object.')
  if (manifest.formatVersion !== BACKUP_ARCHIVE_FORMAT_VERSION) throw new Error('Backup manifest format is unsupported.')
  if (typeof manifest.backupId !== 'string' || !/^[a-f0-9-]{16,64}$/i.test(manifest.backupId)) throw new Error('Backup manifest ID is invalid.')
  if (typeof manifest.createdAt !== 'string' || !Number.isFinite(Date.parse(manifest.createdAt))) throw new Error('Backup manifest timestamp is invalid.')
  if (typeof manifest.appVersion !== 'string' || manifest.appVersion.length === 0 || manifest.appVersion.length > 50) throw new Error('Backup manifest app version is invalid.')
  if (!Number.isSafeInteger(manifest.schemaVersion) || manifest.schemaVersion <= 0) throw new Error('Backup manifest schema version is invalid.')
  normalizeBackupSections(manifest.sections, { demo: manifest.mode === 'demo' })
  if (!['production', 'demo'].includes(manifest.mode)) throw new Error('Backup manifest mode is invalid.')
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error('Backup manifest files are invalid.')
}
