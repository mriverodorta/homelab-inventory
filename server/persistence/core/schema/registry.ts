import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'

export const registrySettings = sqliteTable('registry_settings', {
  id: integer('id').primaryKey(),
  mode: text('mode').notNull().default('disabled'),
  defaultInventorySource: text('default_inventory_source').notNull().default('catalog'),
  automaticContributions: integer('automatic_contributions', { mode: 'boolean' }).notNull().default(false),
  showLinkIndicators: integer('show_link_indicators', { mode: 'boolean' }).notNull().default(false),
  updatedAtMs: integer('updated_at_ms'),
}, (table) => [
  check('registry_settings_singleton_check', sql`${table.id} = 1`),
  check('registry_settings_mode_check', sql`${table.mode} IN ('disabled', 'offline', 'connected')`),
  check('registry_settings_source_tab_check', sql`${table.defaultInventorySource} IN ('catalog', 'manual', 'private-templates')`),
  check('registry_settings_contribution_mode_check', sql`${table.automaticContributions} = 0 OR ${table.mode} = 'connected'`),
])

export const registrySources = sqliteTable('registry_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  kind: text('kind').notNull(),
  displayName: text('display_name').notNull(),
  endpoint: text('endpoint'),
  trustedKeyId: text('trusted_key_id'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  lastCheckedAtMs: integer('last_checked_at_ms'),
  lastSuccessAtMs: integer('last_success_at_ms'),
  lastError: text('last_error'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_sources_identity_unique').on(table.kind, table.endpoint),
  check('registry_sources_kind_check', sql`${table.kind} IN ('official-connected', 'official-offline', 'private')`),
])

export const registryLinks = sqliteTable('registry_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  sourceId: integer('source_id').notNull().references(() => registrySources.id, { onDelete: 'restrict' }),
  templateKey: text('template_key').notNull(),
  importedRevision: integer('imported_revision').notNull(),
  importedContentHash: text('imported_content_hash').notNull(),
  importedFingerprintVersion: integer('imported_fingerprint_version').notNull().default(1),
  availableRevision: integer('available_revision'),
  state: text('state').notNull(),
  linkedAtMs: integer('linked_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_links_item_unique').on(table.itemId),
  index('registry_links_template_index').on(table.sourceId, table.templateKey),
  check('registry_links_revision_check', sql`${table.importedRevision} > 0 AND (${table.availableRevision} IS NULL OR ${table.availableRevision} > 0)`),
  check('registry_links_hash_check', sql`length(${table.importedContentHash}) = 64`),
  check('registry_links_state_check', sql`${table.state} IN ('linked', 'update-available', 'adoption-available', 'detached', 'contribution-pending')`),
])

export const registryInstallationProjection = sqliteTable('registry_installation_projection', {
  id: integer('id').primaryKey(),
  clientInstanceId: text('client_instance_id').notNull(),
  installationKey: text('installation_key').notNull(),
  publicKeyId: text('public_key_id').notNull(),
  state: text('state').notNull(),
  recoveryKey: text('recovery_key'),
  lastError: text('last_error'),
  activatedAtMs: integer('activated_at_ms'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('registry_installation_projection_singleton_check', sql`${table.id} = 1`),
  uniqueIndex('registry_installation_projection_instance_unique').on(table.clientInstanceId),
  check('registry_installation_projection_state_check', sql`${table.state} IN ('active', 'recovery-pending', 'rejected', 'revoked')`),
])

export const registryCatalogAdoptionStatus = sqliteTable('registry_catalog_adoption_status', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => registrySources.id, { onDelete: 'cascade' }),
  catalogRevision: integer('catalog_revision').notNull(),
  applicationVersion: text('application_version').notNull(),
  reportedAtMs: integer('reported_at_ms').notNull(),
  lastError: text('last_error'),
}, (table) => [
  uniqueIndex('registry_catalog_adoption_status_source_unique').on(table.sourceId),
  check('registry_catalog_adoption_status_revision_check', sql`${table.catalogRevision} > 0`),
])

export const registrySnapshots = sqliteTable('registry_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => registrySources.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  templateCount: integer('template_count').notNull(),
  digest: text('digest').notNull(),
  keyId: text('key_id').notNull(),
  activatedAtMs: integer('activated_at_ms').notNull(),
  metadataJson: text('metadata_json').notNull().default('{}'),
}, (table) => [
  uniqueIndex('registry_snapshots_source_revision_unique').on(table.sourceId, table.revision),
  check('registry_snapshots_revision_check', sql`${table.revision} > 0 AND ${table.templateCount} >= 0`),
  check('registry_snapshots_metadata_json_check', sql`json_valid(${table.metadataJson})`),
])

export const registryVariantMatches = sqliteTable('registry_variant_matches', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  sourceId: integer('source_id').notNull().references(() => registrySources.id, { onDelete: 'cascade' }),
  fingerprintVersion: integer('fingerprint_version').notNull(),
  localContentHash: text('local_content_hash').notNull(),
  productFamilyJson: text('product_family_json').notNull(),
  candidatesJson: text('candidates_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_variant_matches_item_source_unique').on(table.itemId, table.sourceId),
  check('registry_variant_matches_hash_check', sql`length(${table.localContentHash}) = 64`),
  check('registry_variant_matches_product_json_check', sql`json_valid(${table.productFamilyJson})`),
  check('registry_variant_matches_candidates_json_check', sql`json_valid(${table.candidatesJson}) AND json_array_length(${table.candidatesJson}) >= 2`),
])

export const registryContributionGroups = sqliteTable('registry_contribution_groups', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  identityHash: text('identity_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  fingerprintVersion: integer('fingerprint_version').notNull(),
  payloadJson: text('payload_json').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_contribution_groups_identity_content_unique').on(table.identityHash, table.contentHash),
  check('registry_contribution_groups_payload_json_check', sql`json_valid(${table.payloadJson})`),
])

export const registryContributionGroupItems = sqliteTable('registry_contribution_group_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => registryContributionGroups.id, { onDelete: 'cascade' }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
}, (table) => [uniqueIndex('registry_contribution_group_items_unique').on(table.groupId, table.itemId)])

export const registryContributionOutbox = sqliteTable('registry_contribution_outbox', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  groupId: integer('group_id').notNull().references(() => registryContributionGroups.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAtMs: integer('available_at_ms').notNull(),
  lastError: text('last_error'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_contribution_outbox_group_unique').on(table.groupId),
  index('registry_contribution_outbox_delivery_index').on(table.state, table.availableAtMs),
  check('registry_contribution_outbox_state_check', sql`${table.state} IN ('queued', 'retrying', 'delivering')`),
])

export const registryContributionLedger = sqliteTable('registry_contribution_ledger', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  identityHash: text('identity_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  fingerprintVersion: integer('fingerprint_version').notNull(),
  state: text('state').notNull(),
  remoteCandidateKey: text('remote_candidate_key'),
  deliveredAtMs: integer('delivered_at_ms'),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_contribution_ledger_item_content_unique').on(table.itemId, table.contentHash),
  check('registry_contribution_ledger_state_check', sql`${table.state} IN ('delivered', 'accepted', 'rejected', 'suppressed')`),
])

export const registryProjectionCache = sqliteTable('registry_projection_cache', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  itemId: integer('item_id').notNull().references(() => inventoryItems.id, { onDelete: 'cascade' }),
  identityHash: text('identity_hash').notNull(),
  contentHash: text('content_hash').notNull(),
  fingerprintVersion: integer('fingerprint_version').notNull(),
  projectionJson: text('projection_json').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('registry_projection_cache_item_unique').on(table.itemId),
  check('registry_projection_cache_json_check', sql`json_valid(${table.projectionJson})`),
])

export const registryPrivateTemplates = sqliteTable('registry_private_templates', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  description: text('description'),
  checksum: text('checksum').notNull(),
  itemJson: text('item_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('registry_private_templates_item_json_check', sql`json_valid(${table.itemJson})`),
  check('registry_private_templates_checksum_check', sql`length(${table.checksum}) = 64`),
])
