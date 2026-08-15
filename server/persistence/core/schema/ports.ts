import { sql } from 'drizzle-orm'
import {
  check,
  foreignKey,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'
import { inventoryItems, inventoryPorts } from './inventory-base.ts'
import { connectorTypes, portKinds } from './vocabularies.ts'

export const portGroups = sqliteTable('port_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  semanticKey: text('semantic_key').notNull(),
  label: text('label').notNull(),
  sortOrder: integer('sort_order').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('port_groups_item_key_unique').on(table.itemId, table.semanticKey),
  uniqueIndex('port_groups_item_sort_unique').on(table.itemId, table.sortOrder),
  check('port_groups_key_check', sql`length(trim(${table.semanticKey})) > 0`),
  check('port_groups_label_check', sql`length(trim(${table.label})) > 0`),
  check('port_groups_sort_check', sql`${table.sortOrder} >= 0`),
])

export const itemPortDetails = sqliteTable('item_port_details', {
  portId: integer('port_id').primaryKey().references(() => inventoryPorts.id, { onDelete: 'cascade' }),
  portGroupId: integer('port_group_id').references(() => portGroups.id, { onDelete: 'set null' }),
  kindId: integer('kind_id').notNull().references(() => portKinds.id, { onDelete: 'restrict' }),
  connectorTypeId: integer('connector_type_id').notNull().references(() => connectorTypes.id, { onDelete: 'restrict' }),
  semanticKey: text('semantic_key'),
  slotNumber: integer('slot_number').notNull(),
  label: text('label'),
  notes: text('notes'),
  ipAddress: text('ip_address'),
  role: text('role'),
  speedBps: integer('speed_bps'),
  poe: integer('poe', { mode: 'boolean' }),
  origin: text('origin').notNull().default('fixed'),
}, (table) => [
  index('item_port_details_group_index').on(table.portGroupId),
  index('item_port_details_kind_index').on(table.kindId),
  index('item_port_details_connector_index').on(table.connectorTypeId),
  check('item_port_details_slot_check', sql`${table.slotNumber} >= 0`),
  check('item_port_details_role_check', sql`
    ${table.role} IS NULL OR ${table.role} IN ('access', 'trunk', 'uplink', 'management', 'disabled')
  `),
  check('item_port_details_speed_check', sql`${table.speedBps} IS NULL OR ${table.speedBps} >= 0`),
  check('item_port_details_poe_check', sql`${table.poe} IS NULL OR ${table.poe} IN (0, 1)`),
  check('item_port_details_origin_check', sql`${table.origin} IN ('fixed', 'module')`),
])

export const portEndpointFaces = sqliteTable('port_endpoint_faces', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  portId: integer('port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'cascade' }),
  endpointNumber: integer('endpoint_number').notNull(),
  side: text('side').notNull(),
}, (table) => [
  uniqueIndex('port_endpoint_faces_port_number_unique').on(table.portId, table.endpointNumber),
  uniqueIndex('port_endpoint_faces_port_id_unique').on(table.portId, table.id),
  check('port_endpoint_faces_number_check', sql`${table.endpointNumber} > 0`),
  check('port_endpoint_faces_side_check', sql`${table.side} IN ('front', 'back')`),
])

export const internalPortLinks = sqliteTable('internal_port_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  firstPortId: integer('first_port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'restrict' }),
  firstEndpointFaceId: integer('first_endpoint_face_id'),
  secondPortId: integer('second_port_id').notNull().references(() => inventoryPorts.id, { onDelete: 'restrict' }),
  secondEndpointFaceId: integer('second_endpoint_face_id'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('internal_port_links_first_unique').on(
    table.firstPortId,
    sql`coalesce(${table.firstEndpointFaceId}, 0)`,
  ),
  uniqueIndex('internal_port_links_second_unique').on(
    table.secondPortId,
    sql`coalesce(${table.secondEndpointFaceId}, 0)`,
  ),
  index('internal_port_links_item_index').on(table.itemId),
  foreignKey({
    name: 'internal_port_links_first_face_fk',
    columns: [table.firstPortId, table.firstEndpointFaceId],
    foreignColumns: [portEndpointFaces.portId, portEndpointFaces.id],
  }).onDelete('restrict'),
  foreignKey({
    name: 'internal_port_links_second_face_fk',
    columns: [table.secondPortId, table.secondEndpointFaceId],
    foreignColumns: [portEndpointFaces.portId, portEndpointFaces.id],
  }).onDelete('restrict'),
  check('internal_port_links_distinct_check', sql`
    ${table.firstPortId} <> ${table.secondPortId}
    OR coalesce(${table.firstEndpointFaceId}, 0) <> coalesce(${table.secondEndpointFaceId}, 0)
  `),
])
