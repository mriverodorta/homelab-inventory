import { and, asc, eq, isNull, or } from 'drizzle-orm'
import type { InventoryType } from '../inventory/field-contract.ts'
import {
  inventoryIdentityAliases,
  inventoryItems,
  inventoryItemTypes,
  manufacturers,
  projectInventoryMemberships,
} from '../schema/index.ts'
import {
  assertPositiveId,
  bumpProjectRevision,
  parseJson,
  type RepositoryContext,
} from './repository-context.ts'

const subtypeTableNames: Readonly<Record<InventoryType, string>> = {
  server: 'servers',
  nas: 'nas_systems',
  pcBuild: 'pc_builds',
  cpu: 'cpus',
  ram: 'memory_modules',
  storage: 'storage_devices',
  gpu: 'graphics_cards',
  network: 'network_cards',
  motherboard: 'motherboards',
  cpuCooler: 'cpu_coolers',
  case: 'computer_cases',
  powerSupply: 'power_supplies',
  soundCard: 'sound_cards',
  wireless: 'wireless_cards',
  powerAdapter: 'power_adapters',
  switch: 'network_switches',
  patchPanel: 'patch_panels',
  monitor: 'monitors',
  ups: 'ups_systems',
  powerStrip: 'power_strips',
}

export type CreateInventoryItemInput = Readonly<{
  type: InventoryType
  name: string
  scope?: 'global' | 'project'
  ownerProjectId?: number | null
  manufacturer?: string | null
  model?: string | null
  family?: string | null
  productNumber?: string | null
  subtype?: string | null
  serialNumber?: string | null
  notes?: string | null
  extensions?: Record<string, unknown>
  projectIds?: readonly number[]
}>

function normalizeManufacturer(value: string) {
  return value.trim().toLocaleLowerCase('en-US').replace(/\s+/gu, ' ')
}

export function createInventoryRepository(context: RepositoryContext) {
  const { db, sqlite, now } = context

  function resolveAlias(type: InventoryType, legacyId: number) {
    assertPositiveId(legacyId, 'Legacy inventory ID')
    return db.select({ itemId: inventoryIdentityAliases.itemId })
      .from(inventoryIdentityAliases)
      .where(and(
        eq(inventoryIdentityAliases.legacyTypeKey, type),
        eq(inventoryIdentityAliases.legacyId, legacyId),
      )).get()?.itemId ?? null
  }

  function get(itemId: number) {
    assertPositiveId(itemId, 'Inventory item ID')
    const row = db.select({
      id: inventoryItems.id,
      type: inventoryItemTypes.key,
      scope: inventoryItems.scope,
      ownerProjectId: inventoryItems.ownerProjectId,
      name: inventoryItems.name,
      manufacturer: manufacturers.name,
      manufacturerText: inventoryItems.manufacturerText,
      model: inventoryItems.model,
      family: inventoryItems.family,
      productNumber: inventoryItems.productNumber,
      subtype: inventoryItems.subtype,
      serialNumber: inventoryItems.serialNumber,
      notes: inventoryItems.notes,
      extensionsJson: inventoryItems.extensionsJson,
      rowVersion: inventoryItems.rowVersion,
      archivedAtMs: inventoryItems.archivedAtMs,
      createdAtMs: inventoryItems.createdAtMs,
      updatedAtMs: inventoryItems.updatedAtMs,
      legacyType: inventoryIdentityAliases.legacyTypeKey,
      legacyId: inventoryIdentityAliases.legacyId,
    }).from(inventoryItems)
      .innerJoin(inventoryItemTypes, eq(inventoryItemTypes.id, inventoryItems.typeId))
      .leftJoin(manufacturers, eq(manufacturers.id, inventoryItems.manufacturerId))
      .leftJoin(inventoryIdentityAliases, eq(inventoryIdentityAliases.itemId, inventoryItems.id))
      .where(eq(inventoryItems.id, itemId)).get()
    if (!row) return null
    return {
      ...row,
      manufacturer: row.manufacturer ?? row.manufacturerText,
      extensions: parseJson(row.extensionsJson, {} as Record<string, unknown>),
    }
  }

  function listForProject(projectId: number, options: { includeArchived?: boolean } = {}) {
    assertPositiveId(projectId, 'Project ID')
    const project = sqlite.query('SELECT includes_global_inventory FROM projects WHERE id = ? AND archived_at_ms IS NULL').get(projectId) as { includes_global_inventory: number } | null
    if (!project) throw new Error(`Active project ${projectId} was not found.`)
    const visible = project.includes_global_inventory
      ? or(eq(inventoryItems.scope, 'global'), eq(projectInventoryMemberships.projectId, projectId), eq(inventoryItems.ownerProjectId, projectId))
      : or(eq(projectInventoryMemberships.projectId, projectId), eq(inventoryItems.ownerProjectId, projectId))
    const condition = options.includeArchived ? visible : and(visible, isNull(inventoryItems.archivedAtMs))
    const rows = db.selectDistinct({ id: inventoryItems.id }).from(inventoryItems)
      .leftJoin(projectInventoryMemberships, eq(projectInventoryMemberships.itemId, inventoryItems.id))
      .where(condition).orderBy(asc(inventoryItems.id)).all()
    return rows.map(({ id }) => get(id)!).filter(Boolean)
  }

  function create(input: CreateInventoryItemInput) {
    const name = input.name.trim()
    if (!name) throw new Error('Inventory item name is required.')
    const scope = input.scope ?? 'global'
    const ownerProjectId = scope === 'project'
      ? assertPositiveId(input.ownerProjectId ?? 0, 'Owner project ID')
      : null
    const projectIds = [...new Set(input.projectIds ?? (ownerProjectId ? [ownerProjectId] : []))]
    projectIds.forEach((id) => assertPositiveId(id, 'Project membership ID'))
    const at = now()
    return sqlite.transaction(() => {
      const type = db.select({ id: inventoryItemTypes.id }).from(inventoryItemTypes)
        .where(eq(inventoryItemTypes.key, input.type)).get()
      if (!type) throw new Error(`Inventory type ${input.type} is not configured.`)
      let manufacturerId: number | null = null
      const manufacturerName = input.manufacturer?.trim() || null
      if (manufacturerName) {
        const normalizedName = normalizeManufacturer(manufacturerName)
        const existing = db.select({ id: manufacturers.id }).from(manufacturers)
          .where(eq(manufacturers.normalizedName, normalizedName)).get()
        manufacturerId = existing?.id ?? db.insert(manufacturers).values({
          name: manufacturerName,
          normalizedName,
          createdAtMs: at,
          updatedAtMs: at,
        }).returning({ id: manufacturers.id }).get().id
      }
      const item = db.insert(inventoryItems).values({
        typeId: type.id,
        scope,
        ownerProjectId,
        name,
        manufacturerId,
        model: input.model?.trim() || null,
        family: input.family?.trim() || null,
        productNumber: input.productNumber?.trim() || null,
        subtype: input.subtype?.trim() || null,
        serialNumber: input.serialNumber?.trim() || null,
        notes: input.notes?.trim() || null,
        extensionsJson: JSON.stringify(input.extensions ?? {}),
        createdAtMs: at,
        updatedAtMs: at,
      }).returning({ id: inventoryItems.id }).get()
      sqlite.query(`INSERT INTO ${subtypeTableNames[input.type]} (id) VALUES (?)`).run(item.id)
      for (const projectId of projectIds) {
        db.insert(projectInventoryMemberships).values({ projectId, itemId: item.id, createdAtMs: at })
          .onConflictDoNothing().run()
        bumpProjectRevision(context, projectId, at)
      }
      return get(item.id)!
    }).immediate()
  }

  function update(itemId: number, expectedRowVersion: number, changes: Partial<Omit<CreateInventoryItemInput, 'type' | 'scope' | 'ownerProjectId' | 'projectIds'>>) {
    const current = get(itemId)
    if (!current) throw new Error(`Inventory item ${itemId} was not found.`)
    if (current.rowVersion !== expectedRowVersion) throw new Error(`Inventory item ${itemId} has changed.`)
    const name = changes.name === undefined ? current.name : changes.name.trim()
    if (!name) throw new Error('Inventory item name is required.')
    const at = now()
    const result = db.update(inventoryItems).set({
      name,
      model: changes.model === undefined ? current.model : changes.model?.trim() || null,
      family: changes.family === undefined ? current.family : changes.family?.trim() || null,
      productNumber: changes.productNumber === undefined ? current.productNumber : changes.productNumber?.trim() || null,
      subtype: changes.subtype === undefined ? current.subtype : changes.subtype?.trim() || null,
      serialNumber: changes.serialNumber === undefined ? current.serialNumber : changes.serialNumber?.trim() || null,
      notes: changes.notes === undefined ? current.notes : changes.notes?.trim() || null,
      extensionsJson: changes.extensions === undefined ? current.extensionsJson : JSON.stringify(changes.extensions),
      rowVersion: expectedRowVersion + 1,
      updatedAtMs: at,
    }).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.rowVersion, expectedRowVersion))).run()
    if (result.changes !== 1) throw new Error(`Inventory item ${itemId} has changed.`)
    return get(itemId)!
  }

  function archive(itemId: number) {
    const at = now()
    const result = db.update(inventoryItems).set({ archivedAtMs: at, updatedAtMs: at })
      .where(and(eq(inventoryItems.id, assertPositiveId(itemId, 'Inventory item ID')), isNull(inventoryItems.archivedAtMs))).run()
    if (result.changes !== 1) throw new Error(`Active inventory item ${itemId} was not found.`)
  }

  function remove(itemId: number) {
    assertPositiveId(itemId, 'Inventory item ID')
    try {
      const deleted = db.delete(inventoryItems).where(eq(inventoryItems.id, itemId))
        .returning({ id: inventoryItems.id }).get()
      if (!deleted) throw new Error(`Inventory item ${itemId} was not found.`)
    } catch (error) {
      throw new Error(`Inventory item ${itemId} cannot be removed while relational dependencies exist.`, { cause: error })
    }
  }

  return { get, listForProject, resolveAlias, create, update, archive, remove }
}

export type InventoryRepository = ReturnType<typeof createInventoryRepository>
