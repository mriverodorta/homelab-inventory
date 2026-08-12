import type { InventoryType } from './field-contract.ts'
import { createInventoryRepository } from '../repositories/inventory-repository.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  type RepositoryContext,
} from '../repositories/repository-context.ts'

export type InventoryScopeTarget = Readonly<{
  scope: 'global' | 'project'
  projectId?: number
}>

export function createInventoryScopeService(context: RepositoryContext) {
  const { sqlite, now } = context
  const inventory = createInventoryRepository(context)

  function memberships(itemId: number) {
    assertPositiveId(itemId, 'Inventory item ID')
    return (sqlite.query(`
      SELECT project_id AS projectId
      FROM project_inventory_memberships
      WHERE item_id = ?
      ORDER BY project_id
    `).all(itemId) as Array<{ projectId: number }>).map(({ projectId }) => projectId)
  }

  function listAvailableGlobal(projectId: number) {
    const project = activeProject(projectId)
    if (!project.includesGlobalInventory) return []
    const itemIds = (sqlite.query(`
      SELECT item.id
      FROM inventory_items item
      WHERE item.scope = 'global'
        AND item.archived_at_ms IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM project_inventory_memberships membership
          WHERE membership.project_id = ? AND membership.item_id = item.id
        )
      ORDER BY item.name COLLATE NOCASE, item.id
    `).all(projectId) as Array<{ id: number }>).map(({ id }) => id)
    return itemIds.map((itemId) => {
      const item = inventory.get(itemId)!
      return {
        id: item.legacyId,
        type: item.legacyType,
        name: item.name,
        manufacturer: item.manufacturer,
        model: item.model,
        family: item.family,
        number: item.productNumber,
        subtype: item.subtype,
        scope: 'global' as const,
      }
    })
  }

  function activeProject(projectId: number) {
    assertPositiveId(projectId, 'Project ID')
    const project = sqlite.query(`
      SELECT id, includes_global_inventory AS includesGlobalInventory
      FROM projects
      WHERE id = ? AND archived_at_ms IS NULL
    `).get(projectId) as { id: number; includesGlobalInventory: number } | null
    if (!project) throw new Error(`Active project ${projectId} was not found.`)
    return project
  }

  function setScope(itemId: number, target: InventoryScopeTarget) {
    const current = inventory.get(itemId)
    if (!current) throw new Error(`Inventory item ${itemId} was not found.`)
    if (current.scope === target.scope) return current
    const projectIds = memberships(itemId)
    const at = now()

    if (target.scope === 'project') {
      if (projectIds.length !== 1) {
        throw new Error('A global item must have exactly one project membership before becoming project-bound.')
      }
      const projectId = target.projectId ?? projectIds[0]
      if (projectId !== projectIds[0]) {
        throw new Error(`Inventory item ${itemId} is not a member of project ${projectId}.`)
      }
      activeProject(projectId)
      sqlite.transaction(() => {
        sqlite.query(`
          UPDATE inventory_items
          SET scope = 'project', owner_project_id = ?, row_version = row_version + 1, updated_at_ms = ?
          WHERE id = ? AND scope = 'global'
        `).run(projectId, at, itemId)
        bumpProjectRevision(context, projectId, at)
      }).immediate()
      return inventory.get(itemId)!
    }

    if (current.ownerProjectId == null) throw new Error(`Project-bound inventory item ${itemId} has no owner.`)
    sqlite.transaction(() => {
      sqlite.query(`
        UPDATE inventory_items
        SET scope = 'global', owner_project_id = NULL, row_version = row_version + 1, updated_at_ms = ?
        WHERE id = ? AND scope = 'project'
      `).run(at, itemId)
      for (const projectId of projectIds) bumpProjectRevision(context, projectId, at)
    }).immediate()
    return inventory.get(itemId)!
  }

  function addGlobalMembership(itemId: number, projectId: number) {
    const current = inventory.get(itemId)
    if (!current) throw new Error(`Inventory item ${itemId} was not found.`)
    if (current.scope !== 'global') throw new Error('Only global inventory can be added to another project.')
    const project = activeProject(projectId)
    if (!project.includesGlobalInventory) {
      throw new Error(`Project ${projectId} does not allow global inventory.`)
    }
    const at = now()
    sqlite.transaction(() => {
      const result = sqlite.query(`
        INSERT INTO project_inventory_memberships (project_id, item_id, created_at_ms)
        VALUES (?, ?, ?)
        ON CONFLICT(project_id, item_id) DO NOTHING
      `).run(projectId, itemId, at)
      if (result.changes > 0) bumpProjectRevision(context, projectId, at)
    }).immediate()
    return memberships(itemId)
  }

  function dependencyCounts(itemId: number, projectId: number) {
    const counts = sqlite.query(`
      SELECT
        (SELECT count(*) FROM workspace_placements WHERE project_id = ? AND item_id = ?) AS placements,
        (SELECT count(*) FROM component_assignments WHERE project_id = ? AND (host_item_id = ? OR component_item_id = ?)) AS assignments,
        (SELECT count(DISTINCT c.id)
          FROM project_connections c
          JOIN connection_endpoints e ON e.connection_id = c.id
          JOIN inventory_ports p ON p.id = e.port_id
          WHERE c.project_id = ? AND p.item_id = ?) AS connections
    `).get(projectId, itemId, projectId, itemId, itemId, projectId, itemId) as {
      placements: number
      assignments: number
      connections: number
    }
    return counts
  }

  function removeGlobalMembership(itemId: number, projectId: number) {
    const current = inventory.get(itemId)
    if (!current) throw new Error(`Inventory item ${itemId} was not found.`)
    if (current.scope !== 'global') throw new Error('Project-bound inventory membership cannot be removed from its owner project.')
    activeProject(projectId)
    const dependencies = dependencyCounts(itemId, projectId)
    if (Object.values(dependencies).some((count) => count > 0)) {
      throw new Error(`Inventory item ${itemId} cannot leave project ${projectId} while topology dependencies exist.`)
    }
    const at = now()
    sqlite.transaction(() => {
      const result = sqlite.query('DELETE FROM project_inventory_memberships WHERE project_id = ? AND item_id = ?')
        .run(projectId, itemId)
      if (result.changes !== 1) throw new Error(`Inventory item ${itemId} is not a member of project ${projectId}.`)
      bumpProjectRevision(context, projectId, at)
    }).immediate()
    return memberships(itemId)
  }

  function resolve(type: InventoryType, legacyId: number) {
    const itemId = inventory.resolveAlias(type, legacyId)
    if (!itemId) throw new Error(`Inventory item ${type}:${legacyId} was not found.`)
    return itemId
  }

  return {
    memberships,
    listAvailableGlobal,
    setScope,
    addGlobalMembership,
    removeGlobalMembership,
    dependencyCounts,
    resolve,
  }
}

export type InventoryScopeService = ReturnType<typeof createInventoryScopeService>
