import { CURRENT_SCHEMA_VERSION } from '../db/store.mjs'
import {
  assertAgentsStoreShape,
  assertAgentStatusStoreShape,
  assertInventoryStoreShape,
  assertProjectStoreShape,
} from '../db/validation.mjs'
import { assertRegistryStoreShape } from '../registry/model.mjs'
import { assertAuthenticationStoreShape } from '../auth/model.mjs'
import { assertBackupManagementStoreShape } from './backup-model.mjs'
import { materializeBackupSections, notificationBackupFromArchive, telemetryBackupFromArchive, validateEnrollmentFiles } from './backup-sections.mjs'
import { validateTelemetryBackup } from '../telemetry/backup.mjs'
import { migrateSchema24To25 } from '../db/migrate-schema-25.mjs'
import { migrateSchema25To26 } from '../db/migrate-schema-26.mjs'

export function preflightRestore({ manifest, files, currentStores }) {
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      sections: manifest.sections,
      changes: [],
      blockers: [{ code: 'newer-schema', message: `This backup requires schema ${manifest.schemaVersion}; this app supports ${CURRENT_SCHEMA_VERSION}.` }],
      warnings: [],
    }
  }
  const replacements = materializeBackupSections({ files, sections: manifest.sections, currentStores })
  if (replacements.meta) replacements.meta.schemaVersion = CURRENT_SCHEMA_VERSION
  const composed = { ...structuredClone(currentStores), ...replacements }
  if (manifest.schemaVersion < 25) {
    const migrated = migrateSchema24To25(composed.agents, composed.agentStatus)
    composed.agents = migrated.agents
    composed.agentStatus = migrated.agentStatus
    if (replacements.agents) replacements.agents = migrated.agents
    if (replacements.agentStatus) replacements.agentStatus = migrated.agentStatus
  }
  if (manifest.schemaVersion < 26) {
    const migrated = migrateSchema25To26(composed.agents)
    composed.agents = migrated.agents
    if (replacements.agents) replacements.agents = migrated.agents
  }
  const blockers = []
  try {
    if (manifest.sections.includes('registryEnrollment')) validateEnrollmentFiles(files)
    assertInventoryStoreShape(composed.inventory)
    assertProjectStoreShape(composed.project, { requireRevision: true })
    assertAgentsStoreShape(composed.agents)
    assertAgentStatusStoreShape(composed.agentStatus)
    assertRegistryStoreShape(composed.registry)
    assertAuthenticationStoreShape(composed.authentication)
    assertBackupManagementStoreShape(composed.backupManagement)
    if (manifest.sections.includes('agentTelemetry')) validateTelemetryBackup(telemetryBackupFromArchive(files), composed)
    if (manifest.sections.includes('notifications') || manifest.sections.includes('notificationHistory')) {
      notificationBackupFromArchive(files, manifest.sections)
    }
  } catch (error) {
    blockers.push({ code: 'dependency-conflict', message: error instanceof Error ? error.message : 'Selected sections are incompatible.' })
  }
  const warnings = []
  if (replacements.routingCache && !replacements.project) {
    warnings.push({ code: 'routing-cache-discardable', message: 'Routing cache will be discarded if it does not match current canvas geometry.' })
  }
  return {
    ok: blockers.length === 0,
    sections: manifest.sections,
    changes: manifest.sections.map((section) => ({ section, action: 'Replace local section' })),
    blockers,
    warnings,
    replacements,
  }
}
