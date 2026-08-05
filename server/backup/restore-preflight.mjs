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
import { materializeBackupSections, validateEnrollmentFiles } from './backup-sections.mjs'

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
