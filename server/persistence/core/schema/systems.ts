import { sql } from 'drizzle-orm'
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { users } from './authentication.ts'
import { inventoryItems } from './inventory-base.ts'
import { projects } from './project-base.ts'
import { customFieldDefinitions, customFieldOptions, inventoryTags } from './inventory-metadata.ts'

export const systemsSavedViews = sqliteTable('systems_saved_views', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  ownerScope: text('owner_scope').notNull(),
  accountId: integer('account_id').references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  sortKey: text('sort_key').notNull(),
  sortDirection: text('sort_direction').notNull(),
  density: text('density').notNull(),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  revision: integer('revision').notNull().default(1),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('systems_saved_views_account_name_unique').on(table.projectId, table.accountId, sql`lower(${table.name})`).where(sql`${table.ownerScope} = 'account'`),
  uniqueIndex('systems_saved_views_open_name_unique').on(table.projectId, sql`lower(${table.name})`).where(sql`${table.ownerScope} = 'open-installation'`),
  uniqueIndex('systems_saved_views_account_default_unique').on(table.projectId, table.accountId).where(sql`${table.ownerScope} = 'account' AND ${table.isDefault} = 1`),
  uniqueIndex('systems_saved_views_open_default_unique').on(table.projectId).where(sql`${table.ownerScope} = 'open-installation' AND ${table.isDefault} = 1`),
  index('systems_saved_views_project_owner_index').on(table.projectId, table.ownerScope, table.accountId, table.updatedAtMs),
  check('systems_saved_views_owner_check', sql`(${table.ownerScope} = 'account' AND ${table.accountId} IS NOT NULL) OR (${table.ownerScope} = 'open-installation' AND ${table.accountId} IS NULL)`),
  check('systems_saved_views_name_check', sql`length(trim(${table.name})) BETWEEN 1 AND 80`),
  check('systems_saved_views_sort_key_check', sql`${table.sortKey} IN ('type','name','manufacturer','cpu','memory','storage','attention','agent','registry','operatingSystem','uptime','lanIp')`),
  check('systems_saved_views_sort_direction_check', sql`${table.sortDirection} IN ('ascending','descending')`),
  check('systems_saved_views_density_check', sql`${table.density} IN ('dense','comfortable')`),
  check('systems_saved_views_revision_check', sql`${table.revision} > 0`),
])

export const systemsSavedViewFilters = sqliteTable('systems_saved_view_filters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  savedViewId: integer('saved_view_id').notNull().references(() => systemsSavedViews.id, { onDelete: 'cascade' }),
  filterCategory: text('filter_category').notNull(),
  filterValue: text('filter_value').notNull(),
}, (table) => [
  uniqueIndex('systems_saved_view_filters_value_unique').on(table.savedViewId, table.filterCategory, table.filterValue),
  index('systems_saved_view_filters_view_index').on(table.savedViewId, table.filterCategory),
  check('systems_saved_view_filters_category_check', sql`${table.filterCategory} IN ('type','registration','registry')`),
])

export const systemsSavedViewColumns = sqliteTable('systems_saved_view_columns', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  savedViewId: integer('saved_view_id').notNull().references(() => systemsSavedViews.id, { onDelete: 'cascade' }),
  columnKey: text('column_key').notNull(),
  definitionId: integer('definition_id').references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  visible: integer('visible', { mode: 'boolean' }).notNull(),
  displayOrder: integer('display_order').notNull(),
}, (table) => [
  uniqueIndex('systems_saved_view_columns_key_unique').on(table.savedViewId, table.columnKey),
  uniqueIndex('systems_saved_view_columns_order_unique').on(table.savedViewId, table.displayOrder),
  index('systems_saved_view_columns_definition_index').on(table.definitionId, table.savedViewId),
  check('systems_saved_view_columns_key_check', sql`(${table.definitionId} IS NULL AND ${table.columnKey} IN ('type','name','manufacturer','cpu','memory','storage','attention','agent','registry','operatingSystem','uptime','lanIp','tags')) OR (${table.definitionId} IS NOT NULL AND ${table.columnKey} = 'custom-field:' || ${table.definitionId})`),
  check('systems_saved_view_columns_order_check', sql`${table.displayOrder} >= 0`),
])

export const systemsSavedViewMetadataFilters = sqliteTable('systems_saved_view_metadata_filters', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  savedViewId: integer('saved_view_id').notNull().references(() => systemsSavedViews.id, { onDelete: 'cascade' }),
  definitionId: integer('definition_id').references(() => customFieldDefinitions.id, { onDelete: 'cascade' }),
  operator: text('operator').notNull(),
  textValue: text('text_value'),
  numberMinimum: real('number_minimum'),
  numberMaximum: real('number_maximum'),
  dateAfter: text('date_after'),
  dateBefore: text('date_before'),
}, (table) => [
  uniqueIndex('systems_saved_view_metadata_filters_definition_unique').on(table.savedViewId, table.definitionId).where(sql`${table.definitionId} IS NOT NULL`),
  uniqueIndex('systems_saved_view_metadata_filters_tag_mode_unique').on(table.savedViewId).where(sql`${table.definitionId} IS NULL`),
  index('systems_saved_view_metadata_filters_view_index').on(table.savedViewId, table.id),
  index('systems_saved_view_metadata_filters_definition_index').on(table.definitionId, table.savedViewId),
])

export const systemsSavedViewMetadataFilterOptions = sqliteTable('systems_saved_view_metadata_filter_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filterId: integer('filter_id').notNull().references(() => systemsSavedViewMetadataFilters.id, { onDelete: 'cascade' }),
  optionId: integer('option_id').notNull().references(() => customFieldOptions.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('systems_saved_view_metadata_filter_options_unique').on(table.filterId, table.optionId),
  index('systems_saved_view_metadata_filter_options_option_index').on(table.optionId, table.filterId),
])

export const systemsSavedViewMetadataFilterTags = sqliteTable('systems_saved_view_metadata_filter_tags', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  filterId: integer('filter_id').notNull().references(() => systemsSavedViewMetadataFilters.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => inventoryTags.id, { onDelete: 'cascade' }),
}, (table) => [
  uniqueIndex('systems_saved_view_metadata_filter_tags_unique').on(table.filterId, table.tagId),
  index('systems_saved_view_metadata_filter_tags_tag_index').on(table.tagId, table.filterId),
])

export const systemAttentionSummaries = sqliteTable('system_attention_summaries', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  hostType: text('host_type').notNull(),
  hostId: integer('host_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  registryCount: integer('registry_count').notNull().default(0),
  auditCount: integer('audit_count').notNull().default(0),
  notificationCount: integer('notification_count').notNull().default(0),
  totalCount: integer('total_count').notNull().default(0),
  inputFingerprint: text('input_fingerprint').notNull(),
  state: text('state').notNull(),
  revision: integer('revision').notNull().default(1),
  evaluatedAtMs: integer('evaluated_at_ms'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('system_attention_summaries_host_unique').on(table.projectId, table.hostType, table.hostId),
  index('system_attention_summaries_project_index').on(table.projectId, table.totalCount, table.state),
  check('system_attention_summaries_host_type_check', sql`${table.hostType} IN ('server','nas','pcBuild')`),
  check('system_attention_summaries_counts_check', sql`${table.registryCount} >= 0 AND ${table.auditCount} >= 0 AND ${table.notificationCount} >= 0 AND ${table.totalCount} = ${table.registryCount} + ${table.auditCount} + ${table.notificationCount}`),
  check('system_attention_summaries_fingerprint_check', sql`length(${table.inputFingerprint}) = 64`),
  check('system_attention_summaries_state_check', sql`${table.state} IN ('current','refreshing','failed')`),
  check('system_attention_summaries_revision_check', sql`${table.revision} > 0`),
])

export const systemAttentionFindings = sqliteTable('system_attention_findings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  summaryId: integer('summary_id').notNull().references(() => systemAttentionSummaries.id, { onDelete: 'cascade' }),
  category: text('category').notNull(),
  findingKey: text('finding_key').notNull(),
  affectedItemType: text('affected_item_type'),
  affectedItemId: integer('affected_item_id').references(() => inventoryItems.id, { onDelete: 'cascade' }),
  severity: text('severity').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  destinationJson: text('destination_json').notNull().default('{}'),
}, (table) => [
  uniqueIndex('system_attention_findings_key_unique').on(table.summaryId, table.category, table.findingKey),
  index('system_attention_findings_summary_index').on(table.summaryId, table.category, table.severity),
  check('system_attention_findings_category_check', sql`${table.category} IN ('registry','audit','notification')`),
  check('system_attention_findings_affected_check', sql`(${table.affectedItemType} IS NULL AND ${table.affectedItemId} IS NULL) OR (${table.affectedItemType} IS NOT NULL AND ${table.affectedItemId} IS NOT NULL)`),
  check('system_attention_findings_severity_check', sql`${table.severity} IN ('info','warning','error','critical')`),
  check('system_attention_findings_destination_json_check', sql`json_valid(${table.destinationJson})`),
])

export const systemAttentionDirtyHosts = sqliteTable('system_attention_dirty_hosts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  hostType: text('host_type').notNull(),
  hostId: integer('host_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('system_attention_dirty_hosts_host_unique').on(table.projectId, table.hostType, table.hostId),
  index('system_attention_dirty_hosts_created_index').on(table.createdAtMs, table.id),
  check('system_attention_dirty_hosts_host_type_check', sql`${table.hostType} IN ('server','nas','pcBuild')`),
])
