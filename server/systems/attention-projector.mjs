import { createHash } from 'node:crypto'

const HOST_TYPES = new Set(['server', 'nas', 'pcBuild'])

function positiveId(value, label) {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new TypeError(`${label} must be a positive safe integer.`)
  return parsed
}

function hostType(value) {
  const type = String(value ?? '')
  if (!HOST_TYPES.has(type)) throw new TypeError('System host type is invalid.')
  return type
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (!value || typeof value !== 'object') return JSON.stringify(value)
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

function fingerprint(value) {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function itemType(database, itemId) {
  return database.query(`
    SELECT type.key FROM inventory_items item
    JOIN inventory_item_types type ON type.id = item.type_id
    WHERE item.id = ?
  `).get(itemId)?.key ?? null
}

function sourceRows(database, projectId, hostId) {
  const assembly = database.query(`
    SELECT ? AS item_id
    UNION
    SELECT component_item_id FROM component_assignments
    WHERE project_id = ? AND host_item_id = ?
  `).all(hostId, projectId, hostId).map((row) => row.item_id)
  const placeholders = assembly.map(() => '?').join(',')
  const registry = placeholders ? database.query(`
    SELECT evaluation.id, evaluation.link_id, evaluation.to_revision,
      evaluation.classification, evaluation.reasons_json,
      link.item_id, item.name AS item_name, type.key AS item_type
    FROM registry_update_evaluations evaluation
    JOIN registry_links link ON link.id = evaluation.link_id
    JOIN inventory_items item ON item.id = link.item_id
    JOIN inventory_item_types type ON type.id = item.type_id
    WHERE link.item_id IN (${placeholders})
      AND evaluation.decision = 'pending'
      AND evaluation.classification IN ('review-required', 'blocked')
      AND NOT EXISTS (
        SELECT 1 FROM registry_update_evaluations newer
        WHERE newer.link_id = evaluation.link_id
          AND (newer.evaluated_at_ms > evaluation.evaluated_at_ms
            OR (newer.evaluated_at_ms = evaluation.evaluated_at_ms AND newer.id > evaluation.id))
      )
    ORDER BY evaluation.id
  `).all(...assembly) : []
  const audit = database.query(`
    SELECT finding.id, finding.finding_key, finding.rule_key, finding.severity,
      finding.message, finding.host_item_id, finding.component_item_id,
      coalesce(component.name, host.name) AS item_name,
      coalesce(component_type.key, host_type.key) AS item_type
    FROM compatibility_audit_findings finding
    JOIN inventory_items host ON host.id = finding.host_item_id
    JOIN inventory_item_types host_type ON host_type.id = host.type_id
    LEFT JOIN inventory_items component ON component.id = finding.component_item_id
    LEFT JOIN inventory_item_types component_type ON component_type.id = component.type_id
    LEFT JOIN compatibility_audit_ignores ignored ON ignored.finding_id = finding.id
    WHERE finding.project_id = ? AND finding.host_item_id = ?
      AND finding.resolved_at_ms IS NULL
      AND finding.classification = 'actionable'
      AND ignored.id IS NULL
    ORDER BY finding.id
  `).all(projectId, hostId)
  const notifications = database.query(`
    SELECT id, event_key, event_type, severity, title, summary, monitored_resource_id
    FROM incidents WHERE host_item_id = ? AND state = 'open' ORDER BY id
  `).all(hostId)
  return { assembly, registry, audit, notifications }
}

function toFindings(rows, hostId) {
  return [
    ...rows.registry.map((entry) => ({
      category: 'registry',
      key: `registry:${entry.link_id}:${entry.to_revision}`,
      itemType: entry.item_type,
      itemId: entry.item_id,
      severity: entry.classification === 'blocked' ? 'error' : 'warning',
      title: `${entry.item_name} has a Registry update`,
      description: entry.classification === 'blocked'
        ? 'The Registry update is blocked and needs resolution.'
        : 'The Registry update is waiting for review.',
      destination: { kind: 'registry-update', linkId: entry.link_id, revision: entry.to_revision },
    })),
    ...rows.audit.map((entry) => ({
      category: 'audit',
      key: `audit:${entry.finding_key}`,
      itemType: entry.item_type,
      itemId: entry.component_item_id ?? entry.host_item_id,
      severity: entry.severity,
      title: entry.item_name,
      description: entry.message,
      destination: { kind: 'audit', findingId: entry.id, ruleKey: entry.rule_key },
    })),
    ...rows.notifications.map((entry) => ({
      category: 'notification',
      key: `notification:${entry.id}`,
      itemType: null,
      itemId: null,
      severity: entry.severity,
      title: entry.title,
      description: entry.summary,
      destination: { kind: 'notification', incidentId: entry.id, hostId },
    })),
  ]
}

function publicSummary(row, categories = null) {
  if (!row) return null
  const includes = (category) => categories === null || categories.has(category)
  const registryCount = includes('registry') ? row.registry_count : 0
  const auditCount = includes('audit') ? row.audit_count : 0
  const notificationCount = includes('notification') ? row.notification_count : 0
  return {
    id: row.id,
    projectId: row.project_id,
    hostType: row.host_type,
    hostId: row.host_id,
    registryCount,
    auditCount,
    notificationCount,
    totalCount: registryCount + auditCount + notificationCount,
    state: row.state,
    revision: row.revision,
    evaluatedAt: row.evaluated_at_ms == null ? null : new Date(row.evaluated_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
  }
}

export class SystemAttentionProjector {
  constructor({ now = () => Date.now(), log = console } = {}) {
    this.now = now
    this.log = log
    this.timer = null
  }

  markHostDirty(store, { projectId, hostType: type, hostId, reason }) {
    const database = store.core.database
    database.query(`
      INSERT INTO system_attention_dirty_hosts (project_id, host_type, host_id, reason, created_at_ms)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id, host_type, host_id) DO UPDATE SET
        reason = excluded.reason, created_at_ms = excluded.created_at_ms
    `).run(positiveId(projectId, 'Project ID'), hostType(type), positiveId(hostId, 'Host ID'), String(reason || 'changed'), this.now())
  }

  markHostsForItemDirty(store, { projectId, itemId, reason }) {
    const database = store.core.database
    const project = positiveId(projectId, 'Project ID')
    const item = positiveId(itemId, 'Item ID')
    const directType = itemType(database, item)
    if (HOST_TYPES.has(directType)) this.markHostDirty(store, { projectId: project, hostType: directType, hostId: item, reason })
    for (const row of database.query(`
      SELECT assignment.host_item_id, type.key AS host_type
      FROM component_assignments assignment
      JOIN inventory_items host ON host.id = assignment.host_item_id
      JOIN inventory_item_types type ON type.id = host.type_id
      WHERE assignment.project_id = ? AND assignment.component_item_id = ?
    `).all(project, item)) {
      this.markHostDirty(store, { projectId: project, hostType: row.host_type, hostId: row.host_item_id, reason })
    }
  }

  markProjectDirty(store, projectId, reason = 'project-changed') {
    const project = positiveId(projectId, 'Project ID')
    for (const row of store.core.database.query(`
      SELECT DISTINCT item.id AS host_id, type.key AS host_type
      FROM inventory_items item
      JOIN inventory_item_types type ON type.id = item.type_id
      LEFT JOIN project_inventory_memberships membership
        ON membership.item_id = item.id AND membership.project_id = ?
      JOIN projects project ON project.id = ? AND project.archived_at_ms IS NULL
      WHERE item.archived_at_ms IS NULL AND type.key IN ('server', 'nas', 'pcBuild')
        AND (item.owner_project_id = project.id OR membership.id IS NOT NULL
          OR (item.scope = 'global' AND project.includes_global_inventory = 1))
    `).all(project, project)) {
      this.markHostDirty(store, { projectId: project, hostType: row.host_type, hostId: row.host_id, reason })
    }
  }

  summaries(store, projectId, categories = null) {
    return new Map(store.core.database.query(`
      SELECT * FROM system_attention_summaries WHERE project_id = ? ORDER BY host_id
    `).all(positiveId(projectId, 'Project ID')).map((row) => [row.host_id, publicSummary(row, categories)]))
  }

  details(store, projectId, type, hostId, categories = null) {
    const database = store.core.database
    const summary = database.query(`
      SELECT * FROM system_attention_summaries
      WHERE project_id = ? AND host_type = ? AND host_id = ?
    `).get(positiveId(projectId, 'Project ID'), hostType(type), positiveId(hostId, 'Host ID'))
    if (!summary) return { summary: null, findings: [] }
    const findings = database.query(`
      SELECT * FROM system_attention_findings WHERE summary_id = ? ORDER BY category, severity DESC, id
    `).all(summary.id).filter((row) => categories === null || categories.has(row.category)).map((row) => ({
      id: row.id,
      category: row.category,
      key: row.finding_key,
      affectedItemType: row.affected_item_type,
      affectedItemId: row.affected_item_id,
      severity: row.severity,
      title: row.title,
      description: row.description,
      destination: JSON.parse(row.destination_json),
    }))
    return { summary: publicSummary(summary, categories), findings }
  }

  reconcile(store, { limit = 25 } = {}) {
    const bounded = Math.min(Math.max(Number(limit) || 25, 1), 100)
    const database = store.core.database
    const dirty = database.query(`
      SELECT * FROM system_attention_dirty_hosts ORDER BY created_at_ms, id LIMIT ?
    `).all(bounded)
    let evaluated = 0
    let reused = 0
    let failed = 0
    for (const entry of dirty) {
      try {
        const rows = sourceRows(database, entry.project_id, entry.host_id)
        const nextFingerprint = fingerprint(rows)
        const current = database.query(`
          SELECT * FROM system_attention_summaries
          WHERE project_id = ? AND host_type = ? AND host_id = ?
        `).get(entry.project_id, entry.host_type, entry.host_id)
        if (current?.input_fingerprint === nextFingerprint && current.state === 'current') {
          database.query('DELETE FROM system_attention_dirty_hosts WHERE id = ?').run(entry.id)
          reused += 1
          continue
        }
        const findings = toFindings(rows, entry.host_id)
        const counts = {
          registry: findings.filter((finding) => finding.category === 'registry').length,
          audit: findings.filter((finding) => finding.category === 'audit').length,
          notification: findings.filter((finding) => finding.category === 'notification').length,
        }
        database.transaction(() => {
          const at = this.now()
          database.query(`
            INSERT INTO system_attention_summaries (
              project_id, host_type, host_id, registry_count, audit_count, notification_count,
              total_count, input_fingerprint, state, revision, evaluated_at_ms, updated_at_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'current', 1, ?, ?)
            ON CONFLICT(project_id, host_type, host_id) DO UPDATE SET
              registry_count = excluded.registry_count,
              audit_count = excluded.audit_count,
              notification_count = excluded.notification_count,
              total_count = excluded.total_count,
              input_fingerprint = excluded.input_fingerprint,
              state = 'current', revision = revision + 1,
              evaluated_at_ms = excluded.evaluated_at_ms, updated_at_ms = excluded.updated_at_ms
          `).run(entry.project_id, entry.host_type, entry.host_id, counts.registry, counts.audit, counts.notification,
            findings.length, nextFingerprint, at, at)
          const summary = database.query(`SELECT id FROM system_attention_summaries WHERE project_id = ? AND host_type = ? AND host_id = ?`).get(entry.project_id, entry.host_type, entry.host_id)
          database.query('DELETE FROM system_attention_findings WHERE summary_id = ?').run(summary.id)
          const insert = database.query(`
            INSERT INTO system_attention_findings (
              summary_id, category, finding_key, affected_item_type, affected_item_id,
              severity, title, description, destination_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          for (const finding of findings) insert.run(summary.id, finding.category, finding.key, finding.itemType, finding.itemId,
            finding.severity, finding.title, finding.description, JSON.stringify(finding.destination))
          database.query('DELETE FROM system_attention_dirty_hosts WHERE id = ?').run(entry.id)
        })()
        evaluated += 1
      } catch (error) {
        const current = database.query(`SELECT id FROM system_attention_summaries WHERE project_id = ? AND host_type = ? AND host_id = ?`).get(entry.project_id, entry.host_type, entry.host_id)
        if (current) database.query(`UPDATE system_attention_summaries SET state = 'failed', updated_at_ms = ? WHERE id = ?`).run(this.now(), current.id)
        failed += 1
        this.log?.error?.('[systems-attention] Projection failed.', error)
      }
    }
    return { claimed: dirty.length, evaluated, reused, failed }
  }

  start(store, { intervalMs = 5_000, limit = 25 } = {}) {
    if (this.timer) return () => this.stop()
    const run = () => this.reconcile(store, { limit })
    queueMicrotask(run)
    this.timer = setInterval(run, intervalMs)
    this.timer.unref?.()
    return () => this.stop()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
