import { createHash } from 'node:crypto'
import {
  evaluateAssignmentCompatibility,
  evaluateProjectCompatibility,
  isHostCompatibilityEnabled,
  normalizeHostCapabilities,
  planHostAllocations,
} from '../../shared/compatibility/index.mjs'
import { CPU_GENERATION_ALIAS_VERSION } from '../../shared/compatibility/cpu-generation-aliases.mjs'
import { buildLegacyProjectProjection } from '../persistence/core/projections/legacy-project.ts'

export const COMPATIBILITY_AUDIT_ENGINE_VERSION = `canonical-v2.cpu-alias-${CPU_GENERATION_ALIAS_VERSION}`

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])
const RECONCILIATION_BATCH_SIZE = 100

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`)
  }
  return parsed
}

function hostType(value) {
  const normalized = String(value ?? '')
  if (!HOST_TYPES.has(normalized)) throw new TypeError('Compatibility host type is invalid.')
  return normalized
}

function aliasKey(type, id) {
  return `${type}:${id}`
}

function stableFindingKey({ projectId, workspaceId, hostItemId, assignmentId, finding }) {
  return createHash('sha256').update(JSON.stringify([
    projectId,
    workspaceId,
    hostItemId,
    assignmentId ?? null,
    finding.code,
    finding.field ?? null,
    finding.resourceId ?? null,
  ])).digest('hex')
}

function severity(finding) {
  if (finding.severity === 'error') return 'error'
  if (finding.severity === 'warning') return 'warning'
  return 'info'
}

function classification(finding) {
  return finding.classification === 'informational' || finding.severity === 'unknown'
    ? 'informational'
    : 'actionable'
}

function inventoryAliases(database) {
  return new Map(database.query(`
    SELECT item.id, type.key AS item_type, alias.legacy_id
    FROM inventory_items item
    JOIN inventory_item_types type ON type.id = item.type_id
    JOIN inventory_identity_aliases alias ON alias.item_id = item.id
  `).all().map((row) => [aliasKey(row.item_type, row.legacy_id), row.id]))
}

function resourceSlotForAssignment(database, assignmentId) {
  return database.query(`
    SELECT coalesce(slot.resource_slot_id, assignment.resource_slot_id) AS resource_slot_id
    FROM component_assignments assignment
    LEFT JOIN component_assignment_slots slot
      ON slot.assignment_id = assignment.id AND slot.position = 0
    WHERE assignment.id = ?
  `).get(assignmentId)?.resource_slot_id ?? null
}

function resourceGroups(host, resourceType) {
  const capabilities = normalizeHostCapabilities(host)
  if (resourceType === 'storage') return capabilities.storageSlots ?? []
  if (resourceType === 'expansion') return capabilities.expansionSlots ?? []
  if (resourceType === 'optionalModule') return capabilities.optionalModuleSlots ?? []
  return []
}

function hasAvailablePositions(project, assignment, resourceType, group, size) {
  const occupied = new Set(project.assignments.flatMap((candidate) => (
    candidate.id !== assignment.id
      && candidate.serverId === assignment.serverId
      && candidate.allocation?.resourceType === resourceType
      && candidate.allocation?.groupId === group.id
      ? candidate.allocation.positions
      : []
  )))
  for (let start = 0; start + size <= group.count; start += 1) {
    if (Array.from({ length: size }, (_, offset) => start + offset).every((position) => !occupied.has(position))) {
      return true
    }
  }
  return false
}

function deterministicLegacyAllocations(project, dirtyHosts, aliases) {
  const allocations = []
  const ambiguous = []
  for (const entry of dirtyHosts) {
    const hostAlias = [...aliases.entries()].find(([, canonicalId]) => canonicalId === entry.host_item_id)?.[0]
    const host = hostAlias ? project.items[hostAlias] : null
    if (!host || !isHostCompatibilityEnabled(project, hostAlias)) continue
    const planned = planHostAllocations(project, hostAlias)
    for (const assignment of planned.assignments) {
      const original = project.assignments.find((candidate) => candidate.id === assignment.id)
      if (original?.allocation || !assignment.allocation) continue
      const { resourceType, groupId, positions } = assignment.allocation
      if (!['storage', 'expansion', 'optionalModule'].includes(resourceType) || !groupId) continue
      const component = project.items[String(assignment.itemId)]
      if (!component) continue
      const size = Math.max(positions.length, 1)
      const candidates = resourceGroups(host, resourceType).filter((group) => {
        if (!hasAvailablePositions(project, original, resourceType, group, size)) return false
        return evaluateAssignmentCompatibility({
          host,
          component,
          assignments: project.assignments.filter((candidate) => candidate.id !== assignment.id),
          items: project.items,
          assignedAllocation: { resourceType, groupId: group.id, positions: [0] },
        }).status === 'compatible'
      })
      if (candidates.length === 1 && candidates[0].id === groupId) {
        allocations.push({
          assignmentId: Number(assignment.id),
          hostItemId: entry.host_item_id,
          resourceType,
          groupId,
          positions,
        })
      } else if (candidates.length > 1) {
        ambiguous.push({
          assignmentId: assignment.id,
          hostId: hostAlias,
          itemId: assignment.itemId,
          result: {
            status: 'incompatible',
            findings: [{
              code: 'compatibility.resource.ambiguous',
              severity: 'error',
              classification: 'actionable',
              message: 'The component matches multiple host resources. Select its assigned slot before compatibility can be verified.',
              field: `host.${resourceType}Resources`,
            }],
          },
        })
      }
    }
  }
  return { allocations, ambiguous }
}

function publicFinding(row) {
  return {
    id: row.id,
    findingKey: row.finding_key,
    ruleKey: row.rule_key,
    classification: row.classification,
    severity: row.severity,
    message: row.message,
    details: JSON.parse(row.details_json),
    host: {
      itemId: row.host_item_id,
      type: row.host_type,
      legacyId: row.host_legacy_id,
      name: row.host_name,
    },
    component: row.component_item_id == null ? null : {
      itemId: row.component_item_id,
      type: row.component_type,
      legacyId: row.component_legacy_id,
      name: row.component_name,
    },
    assignmentId: row.assignment_id,
    resourceSlotId: row.resource_slot_id,
    ignored: row.ignore_id != null,
    firstSeenAt: new Date(row.first_seen_at_ms).toISOString(),
    lastSeenAt: new Date(row.last_seen_at_ms).toISOString(),
  }
}

export class CompatibilityAuditService {
  constructor({ now = () => Date.now(), log = console, onChanged = null } = {}) {
    this.now = now
    this.log = log
    this.onChanged = onChanged
    this.scheduledStores = new WeakSet()
    this.engineVersion = COMPATIBILITY_AUDIT_ENGINE_VERSION
  }

  markHostDirty(store, { projectId, workspaceId = store.workspaceId, hostItemId, reason = 'changed' }) {
    store.core.database.query(`
      INSERT INTO compatibility_audit_dirty_hosts (
        project_id, workspace_id, host_item_id, reason, enqueued_at_ms
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, workspace_id, host_item_id) DO UPDATE SET
        reason = excluded.reason,
        enqueued_at_ms = excluded.enqueued_at_ms
    `).run(
      positiveId(projectId, 'Project ID'),
      positiveId(workspaceId, 'Workspace ID'),
      positiveId(hostItemId, 'Host item ID'),
      String(reason || 'changed'),
      this.now(),
    )
  }

  markProjectDirty(store, projectId, reason = 'project-changed') {
    const project = positiveId(projectId, 'Project ID')
    const rows = store.core.database.query(`
      SELECT DISTINCT item.id, workspace.id AS workspace_id
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      JOIN projects project ON project.id = ? AND project.archived_at_ms IS NULL
      JOIN workspaces workspace
        ON workspace.project_id = project.id
       AND workspace.type = 'canvas'
       AND workspace.archived_at_ms IS NULL
      WHERE item.archived_at_ms IS NULL
        AND type.key IN ('server', 'nas', 'pcBuild')
        AND (
          item.owner_project_id = project.id
          OR membership.id IS NOT NULL
          OR (item.scope = 'global' AND project.includes_global_inventory = 1)
        )
    `).all(project, project)
    for (const row of rows) {
      this.markHostDirty(store, {
        projectId: project,
        workspaceId: row.workspace_id,
        hostItemId: row.id,
        reason,
      })
    }
  }

  markHostsForItemDirty(store, { projectId, itemId, reason = 'item-changed' }) {
    const project = positiveId(projectId, 'Project ID')
    const item = positiveId(itemId, 'Item ID')
    const direct = store.core.database.query(`
      SELECT type.key
      FROM inventory_items inventory
      JOIN inventory_item_types type ON type.id = inventory.type_id
      WHERE inventory.id = ?
    `).get(item)
    if (HOST_TYPES.has(direct?.key)) {
      for (const workspace of store.core.database.query(`
        SELECT id FROM workspaces
        WHERE project_id = ? AND type = 'canvas' AND archived_at_ms IS NULL
      `).all(project)) {
        this.markHostDirty(store, {
          projectId: project,
          workspaceId: workspace.id,
          hostItemId: item,
          reason,
        })
      }
    }
    for (const row of store.core.database.query(`
      SELECT DISTINCT host_item_id, workspace_id
      FROM component_assignments
      WHERE project_id = ? AND component_item_id = ?
    `).all(project, item)) {
      this.markHostDirty(store, {
        projectId: project,
        workspaceId: row.workspace_id,
        hostItemId: row.host_item_id,
        reason,
      })
    }
  }

  schedule(store) {
    if (this.scheduledStores.has(store)) return
    this.scheduledStores.add(store)
    queueMicrotask(() => {
      this.scheduledStores.delete(store)
      try {
        const result = this.reconcile(store, { limit: RECONCILIATION_BATCH_SIZE })
        if (result.failed === 0 && result.claimed === RECONCILIATION_BATCH_SIZE) {
          this.schedule(store)
        }
      } catch (error) {
        this.log?.error?.('[compatibility-audit] Reconciliation failed.', error)
      }
    })
  }

  reconcile(store, { limit = 100 } = {}) {
    const database = store.core.database
    const dirty = database.query(`
      SELECT * FROM compatibility_audit_dirty_hosts
      ORDER BY enqueued_at_ms, id LIMIT ?
    `).all(Math.min(Math.max(Number(limit) || 100, 1), 500))
    if (dirty.length === 0) return { claimed: 0, evaluated: 0, failed: 0 }

    const scopes = [...new Map(dirty.map((entry) => [
      `${entry.project_id}:${entry.workspace_id}`,
      { projectId: entry.project_id, workspaceId: entry.workspace_id },
    ])).values()]
    const aliases = inventoryAliases(database)
    let evaluated = 0
    let failed = 0

    for (const { projectId, workspaceId } of scopes) {
      const projectDirty = dirty.filter((entry) => (
        entry.project_id === projectId && entry.workspace_id === workspaceId
      ))
      try {
        let project = buildLegacyProjectProjection({ database, projectId, workspaceId })
        const allocationPlan = deterministicLegacyAllocations(project, projectDirty, aliases)
        if (allocationPlan.allocations.length > 0 && typeof store.persistDeterministicCompatibilityAllocations === 'function') {
          const scopedStore = store.projectId === projectId && store.workspaceId === workspaceId
            ? store
            : store.forWorkspace(projectId, workspaceId)
          scopedStore.persistDeterministicCompatibilityAllocations(allocationPlan.allocations)
          project = buildLegacyProjectProjection({ database, projectId, workspaceId })
        }
        const results = [
          ...evaluateProjectCompatibility(project),
          ...allocationPlan.ambiguous,
        ]
        const resultsByHost = new Map()
        for (const result of results) {
          const existing = resultsByHost.get(String(result.hostId)) ?? []
          existing.push(result)
          resultsByHost.set(String(result.hostId), existing)
        }

        for (const entry of projectDirty) {
          const hostAlias = database.query(`
            SELECT type.key AS host_type, alias.legacy_id
            FROM inventory_items item
            JOIN inventory_item_types type ON type.id = item.type_id
            JOIN inventory_identity_aliases alias ON alias.item_id = item.id
            WHERE item.id = ?
          `).get(entry.host_item_id)
          if (!hostAlias || !HOST_TYPES.has(hostAlias.host_type)) {
            database.query('DELETE FROM compatibility_audit_dirty_hosts WHERE id = ?').run(entry.id)
            continue
          }
          const projectedHostKey = aliasKey(hostAlias.host_type, hostAlias.legacy_id)
          const hostResults = isHostCompatibilityEnabled(project, projectedHostKey)
            ? resultsByHost.get(projectedHostKey) ?? []
            : []
          const now = this.now()
          database.transaction(() => {
            const revision = Number(project.revision ?? 1)
            const audit = database.query(`
              INSERT INTO compatibility_audits (
                project_id, workspace_id, state, input_revision, engine_version, started_at_ms, completed_at_ms
              ) VALUES (?, ?, 'completed', ?, ?, ?, ?)
              RETURNING id
            `).get(projectId, workspaceId, Math.max(revision, 1), COMPATIBILITY_AUDIT_ENGINE_VERSION, now, now)

            database.query(`
              UPDATE compatibility_audit_findings
              SET resolved_at_ms = ?
              WHERE project_id = ? AND workspace_id = ? AND host_item_id = ? AND resolved_at_ms IS NULL
            `).run(now, projectId, workspaceId, entry.host_item_id)

            const insert = database.query(`
              INSERT INTO compatibility_audit_findings (
                project_id, workspace_id, host_item_id, component_item_id, assignment_id, resource_slot_id,
                finding_key, rule_key, severity, classification, message, details_json,
                first_seen_at_ms, last_seen_at_ms, resolved_at_ms
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
              ON CONFLICT(project_id, workspace_id, finding_key) DO UPDATE SET
                host_item_id = excluded.host_item_id,
                component_item_id = excluded.component_item_id,
                assignment_id = excluded.assignment_id,
                resource_slot_id = excluded.resource_slot_id,
                rule_key = excluded.rule_key,
                severity = excluded.severity,
                classification = excluded.classification,
                message = excluded.message,
                details_json = excluded.details_json,
                last_seen_at_ms = excluded.last_seen_at_ms,
                resolved_at_ms = NULL
            `)
            for (const result of hostResults) {
              const componentItemId = aliases.get(String(result.itemId)) ?? null
              const assignmentId = positiveId(result.assignmentId, 'Assignment ID')
              const resourceSlotId = resourceSlotForAssignment(database, assignmentId)
              for (const finding of result.findings) {
                insert.run(
                  projectId,
                  workspaceId,
                  entry.host_item_id,
                  componentItemId,
                  assignmentId,
                  resourceSlotId,
                  stableFindingKey({ projectId, workspaceId, hostItemId: entry.host_item_id, assignmentId, finding }),
                  finding.code,
                  severity(finding),
                  classification(finding),
                  finding.message,
                  JSON.stringify({
                    auditId: audit.id,
                    field: finding.field ?? null,
                    resourceId: finding.resourceId ?? null,
                  }),
                  now,
                  now,
                )
              }
            }
            database.query('DELETE FROM compatibility_audit_dirty_hosts WHERE id = ?').run(entry.id)
          }).immediate()
          evaluated += 1
          this.onChanged?.(store, {
            projectId,
            workspaceId,
            hostType: hostAlias.host_type,
            hostId: hostAlias.legacy_id,
            hostItemId: entry.host_item_id,
            counts: this.hostCounts(store, projectId, entry.host_item_id, workspaceId),
          })
        }
      } catch (error) {
        failed += projectDirty.length
        this.log?.error?.('[compatibility-audit] Project reconciliation failed.', error)
      }
    }
    return { claimed: dirty.length, evaluated, failed }
  }

  hostCounts(store, projectId, hostItemId, workspaceId = store.workspaceId) {
    const row = store.core.database.query(`
      SELECT
        count(*) FILTER (WHERE classification = 'actionable') AS actionable_count,
        count(*) FILTER (WHERE classification = 'informational') AS informational_count
      FROM compatibility_audit_findings finding
      LEFT JOIN compatibility_audit_ignores ignored ON ignored.finding_id = finding.id
      WHERE project_id = ? AND workspace_id = ? AND host_item_id = ? AND resolved_at_ms IS NULL
        AND ignored.id IS NULL
    `).get(
      positiveId(projectId, 'Project ID'),
      positiveId(workspaceId, 'Workspace ID'),
      positiveId(hostItemId, 'Host item ID'),
    )
    return {
      actionable: Number(row?.actionable_count ?? 0),
      informational: Number(row?.informational_count ?? 0),
    }
  }

  summaries(store, projectId, workspaceId = store.workspaceId) {
    return store.core.database.query(`
      SELECT finding.host_item_id,
        type.key AS host_type,
        alias.legacy_id AS host_id,
        count(*) FILTER (WHERE finding.classification = 'actionable') AS actionable_count,
        count(*) FILTER (WHERE finding.classification = 'informational') AS informational_count
      FROM compatibility_audit_findings finding
      JOIN inventory_items host ON host.id = finding.host_item_id
      JOIN inventory_item_types type ON type.id = host.type_id
      JOIN inventory_identity_aliases alias ON alias.item_id = host.id
      LEFT JOIN compatibility_audit_ignores ignored ON ignored.finding_id = finding.id
      WHERE finding.project_id = ? AND finding.workspace_id = ? AND finding.resolved_at_ms IS NULL
        AND ignored.id IS NULL
      GROUP BY finding.host_item_id, type.key, alias.legacy_id
      ORDER BY finding.host_item_id
    `).all(positiveId(projectId, 'Project ID'), positiveId(workspaceId, 'Workspace ID')).map((row) => ({
      hostItemId: row.host_item_id,
      hostType: row.host_type,
      hostId: row.host_id,
      actionable: Number(row.actionable_count),
      informational: Number(row.informational_count),
    }))
  }

  findings(store, {
    projectId,
    workspaceId = store.workspaceId,
    classification: requestedClassification = null,
    hostType: requestedHostType = null,
    hostId = null,
    visibility = 'open',
  }) {
    const conditions = ['finding.project_id = ?', 'finding.workspace_id = ?', 'finding.resolved_at_ms IS NULL']
    const values = [positiveId(projectId, 'Project ID'), positiveId(workspaceId, 'Workspace ID')]
    if (!['open', 'ignored', 'all'].includes(visibility)) {
      throw new TypeError('Compatibility finding visibility is invalid.')
    }
    if (visibility === 'open') conditions.push('ignored.id IS NULL')
    if (visibility === 'ignored') conditions.push('ignored.id IS NOT NULL')
    if (requestedClassification) {
      if (!['actionable', 'informational'].includes(requestedClassification)) {
        throw new TypeError('Compatibility finding classification is invalid.')
      }
      conditions.push('finding.classification = ?')
      values.push(requestedClassification)
    }
    if (requestedHostType || hostId) {
      conditions.push('host_type.key = ?', 'host_alias.legacy_id = ?')
      values.push(hostType(requestedHostType), positiveId(hostId, 'Host ID'))
    }
    return store.core.database.query(`
      SELECT finding.*, ignored.id AS ignore_id,
        host.name AS host_name, host_type.key AS host_type, host_alias.legacy_id AS host_legacy_id,
        component.name AS component_name, component_type.key AS component_type,
        component_alias.legacy_id AS component_legacy_id
      FROM compatibility_audit_findings finding
      JOIN inventory_items host ON host.id = finding.host_item_id
      JOIN inventory_item_types host_type ON host_type.id = host.type_id
      JOIN inventory_identity_aliases host_alias ON host_alias.item_id = host.id
      LEFT JOIN inventory_items component ON component.id = finding.component_item_id
      LEFT JOIN inventory_item_types component_type ON component_type.id = component.type_id
      LEFT JOIN inventory_identity_aliases component_alias ON component_alias.item_id = component.id
      LEFT JOIN compatibility_audit_ignores ignored ON ignored.finding_id = finding.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY finding.classification, finding.severity DESC, finding.id
    `).all(...values).map(publicFinding)
  }

  setIgnored(store, { projectId, findingId, ignored, accountId = null }) {
    const project = positiveId(projectId, 'Project ID')
    const finding = positiveId(findingId, 'Compatibility finding ID')
    const row = store.core.database.query(`
      SELECT finding.host_item_id, finding.workspace_id,
        type.key AS host_type, alias.legacy_id AS host_id
      FROM compatibility_audit_findings finding
      JOIN inventory_items host ON host.id = finding.host_item_id
      JOIN inventory_item_types type ON type.id = host.type_id
      JOIN inventory_identity_aliases alias ON alias.item_id = host.id
      WHERE finding.id = ? AND finding.project_id = ? AND finding.resolved_at_ms IS NULL
    `).get(finding, project)
    if (!row) {
      const error = new Error('Compatibility finding was not found.')
      error.status = 404
      error.code = 'compatibility-finding-not-found'
      throw error
    }
    if (ignored) {
      const userId = Number.isSafeInteger(Number(accountId)) && Number(accountId) > 0
        ? Number(accountId)
        : null
      store.core.database.query(`
        INSERT INTO compatibility_audit_ignores (
          finding_id, ignored_by_user_id, ignored_at_ms
        ) VALUES (?, ?, ?)
        ON CONFLICT(finding_id) DO UPDATE SET
          ignored_by_user_id = excluded.ignored_by_user_id,
          ignored_at_ms = excluded.ignored_at_ms
      `).run(finding, userId, this.now())
    } else {
      store.core.database.query('DELETE FROM compatibility_audit_ignores WHERE finding_id = ?').run(finding)
    }
    const counts = this.hostCounts(store, project, row.host_item_id, row.workspace_id)
    this.onChanged?.(store, {
      projectId: project,
      workspaceId: row.workspace_id,
      hostType: row.host_type,
      hostId: row.host_id,
      hostItemId: row.host_item_id,
      counts,
    })
    return { findingId: finding, ignored: Boolean(ignored), counts }
  }
}
