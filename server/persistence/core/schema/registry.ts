import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { inventoryItems } from './inventory-base.ts'
import { users } from './authentication.ts'

export const registrySettings = sqliteTable('registry_settings', {
  id: integer('id').primaryKey(),
  mode: text('mode').notNull().default('disabled'),
  defaultInventorySource: text('default_inventory_source').notNull().default('catalog'),
  automaticContributions: integer('automatic_contributions', { mode: 'boolean' }).notNull().default(false),
  automaticSafeUpdates: integer('automatic_safe_updates', { mode: 'boolean' }).notNull().default(true),
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
  availableContentHash: text('available_content_hash'),
  productFamilyJson: text('product_family_json'),
  variantEvidenceJson: text('variant_evidence_json'),
  identityAliasesJson: text('identity_aliases_json'),
  state: text('state').notNull(),
  linkedAtMs: integer('linked_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
  detachedAtMs: integer('detached_at_ms'),
}, (table) => [
  uniqueIndex('registry_links_item_unique').on(table.itemId),
  index('registry_links_template_index').on(table.sourceId, table.templateKey),
  check('registry_links_revision_check', sql`${table.importedRevision} > 0 AND (${table.availableRevision} IS NULL OR ${table.availableRevision} > 0)`),
  check('registry_links_hash_check', sql`length(${table.importedContentHash}) = 64 AND (${table.availableContentHash} IS NULL OR length(${table.availableContentHash}) = 64)`),
  check('registry_links_product_family_json_check', sql`${table.productFamilyJson} IS NULL OR json_valid(${table.productFamilyJson})`),
  check('registry_links_variant_evidence_json_check', sql`${table.variantEvidenceJson} IS NULL OR json_valid(${table.variantEvidenceJson})`),
  check('registry_links_identity_aliases_json_check', sql`${table.identityAliasesJson} IS NULL OR json_valid(${table.identityAliasesJson})`),
  check('registry_links_state_check', sql`${table.state} IN ('linked', 'update-available', 'adoption-available', 'detached', 'contribution-pending')`),
])

export const registryUpdateRuns = sqliteTable('registry_update_runs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sourceId: integer('source_id').notNull().references(() => registrySources.id, { onDelete: 'cascade' }),
  catalogRevision: integer('catalog_revision').notNull(),
  state: text('state').notNull(),
  automatic: integer('automatic', { mode: 'boolean' }).notNull().default(true),
  appliedCount: integer('applied_count').notNull().default(0),
  reviewCount: integer('review_count').notNull().default(0),
  blockedCount: integer('blocked_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  attemptCount: integer('attempt_count').notNull().default(0),
  retryAfterMs: integer('retry_after_ms'),
  error: text('error'),
  startedAtMs: integer('started_at_ms').notNull(),
  completedAtMs: integer('completed_at_ms'),
}, (table) => [
  uniqueIndex('registry_update_runs_source_revision_unique').on(table.sourceId, table.catalogRevision),
  check('registry_update_runs_revision_check', sql`${table.catalogRevision} > 0`),
  check('registry_update_runs_state_check', sql`${table.state} IN ('running', 'completed', 'failed')`),
  check('registry_update_runs_counts_check', sql`${table.appliedCount} >= 0 AND ${table.reviewCount} >= 0 AND ${table.blockedCount} >= 0 AND ${table.skippedCount} >= 0 AND ${table.attemptCount} >= 0`),
])

export const registryUpdateEvaluations = sqliteTable('registry_update_evaluations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: integer('run_id').notNull().references(() => registryUpdateRuns.id, { onDelete: 'cascade' }),
  linkId: integer('link_id').notNull().references(() => registryLinks.id, { onDelete: 'cascade' }),
  fromRevision: integer('from_revision').notNull(),
  toRevision: integer('to_revision').notNull(),
  targetContentHash: text('target_content_hash').notNull(),
  classification: text('classification').notNull(),
  decision: text('decision').notNull(),
  reasonsJson: text('reasons_json').notNull().default('[]'),
  changesJson: text('changes_json').notNull().default('[]'),
  decidedByUserId: integer('decided_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  evaluatedAtMs: integer('evaluated_at_ms').notNull(),
  decidedAtMs: integer('decided_at_ms'),
}, (table) => [
  uniqueIndex('registry_update_evaluations_run_link_unique').on(table.runId, table.linkId),
  index('registry_update_evaluations_review_index').on(table.decision, table.classification),
  check('registry_update_evaluations_revision_check', sql`${table.fromRevision} > 0 AND ${table.toRevision} >= ${table.fromRevision}`),
  check('registry_update_evaluations_hash_check', sql`length(${table.targetContentHash}) = 64`),
  check('registry_update_evaluations_classification_check', sql`${table.classification} IN ('safe', 'review-required', 'blocked', 'skipped')`),
  check('registry_update_evaluations_decision_check', sql`${table.decision} IN ('pending', 'applied', 'declined', 'superseded', 'failed')`),
  check('registry_update_evaluations_reasons_json_check', sql`json_valid(${table.reasonsJson}) AND json_array_length(${table.reasonsJson}) >= 0`),
  check('registry_update_evaluations_changes_json_check', sql`json_valid(${table.changesJson}) AND json_array_length(${table.changesJson}) >= 0`),
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
