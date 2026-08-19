import { sql } from 'drizzle-orm'
import { check, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable('projects', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  iconKey: text('icon_key').notNull().default('folder'),
  revision: integer('revision').notNull().default(1),
  workbookRevision: integer('workbook_revision').notNull().default(1),
  includesGlobalInventory: integer('includes_global_inventory', { mode: 'boolean' }).notNull().default(true),
  archivedAtMs: integer('archived_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('projects_active_name_unique')
    .on(sql`lower(${table.name})`)
    .where(sql`${table.archivedAtMs} IS NULL`),
  check('projects_name_check', sql`length(trim(${table.name})) > 0`),
  check('projects_revision_check', sql`${table.revision} > 0`),
  check('projects_workbook_revision_check', sql`${table.workbookRevision} > 0`),
])
