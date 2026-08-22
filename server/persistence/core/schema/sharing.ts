import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { customFieldDefinitions, inventoryTags } from './inventory-metadata.ts'
import { projects, workspaces } from './projects.ts'

export const sharingSettings = sqliteTable('sharing_settings', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(1),
  connectionEnabled: integer('connection_enabled', { mode: 'boolean' }).notNull().default(true),
  enrollmentState: text('enrollment_state').notNull().default('pending'),
  attemptCount: integer('attempt_count').notNull().default(0),
  nextAttemptAtMs: integer('next_attempt_at_ms'),
  lastErrorCode: text('last_error_code'),
  remoteEventCursor: integer('remote_event_cursor').notNull().default(0),
  recoveryState: text('recovery_state'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('sharing_settings_singleton_check', sql`${table.id} = 1`),
  check('sharing_settings_revision_check', sql`${table.revision} > 0`),
  check('sharing_settings_state_check', sql`${table.enrollmentState} IN ('pending','connected','retrying','recovery-pending','disabled','unsupported')`),
  check('sharing_settings_attempt_check', sql`${table.attemptCount} >= 0`),
  check('sharing_settings_cursor_check', sql`${table.remoteEventCursor} >= 0`),
  check('sharing_settings_recovery_check', sql`${table.recoveryState} IS NULL OR ${table.recoveryState} IN ('pending-owner-approval','approved')`),
])

export const sharingInstallationProjection = sqliteTable('sharing_installation_projection', {
  id: integer('id').primaryKey(),
  clientInstanceId: text('client_instance_id').notNull(),
  keyId: text('key_id').notNull(),
  publicKeySpki: text('public_key_spki').notNull(),
  identityHash: text('identity_hash').notNull(),
  remoteInstallationId: integer('remote_installation_id'),
  credentialExpiresAtMs: integer('credential_expires_at_ms'),
  state: text('state').notNull(),
  recoveryPublicKeySpki: text('recovery_public_key_spki'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('sharing_installation_projection_instance_unique').on(table.clientInstanceId),
  uniqueIndex('sharing_installation_projection_identity_unique').on(table.identityHash),
  check('sharing_installation_projection_singleton_check', sql`${table.id} = 1`),
  check('sharing_installation_projection_remote_id_check', sql`${table.remoteInstallationId} IS NULL OR ${table.remoteInstallationId} > 0`),
  check('sharing_installation_projection_state_check', sql`${table.state} IN ('local','active','recovery-pending','disabled')`),
])

export const shares = sqliteTable('shares', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: integer('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  remotePublicId: text('remote_public_id'),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  mutability: text('mutability').notNull(),
  syncMode: text('sync_mode').notNull(),
  visibility: text('visibility').notNull(),
  state: text('state').notNull().default('unpublished'),
  commentsEnabled: integer('comments_enabled', { mode: 'boolean' }).notNull().default(false),
  reactionsEnabled: integer('reactions_enabled', { mode: 'boolean' }).notNull().default(false),
  expirationType: text('expiration_type').notNull().default('indefinite'),
  expirationDurationSeconds: integer('expiration_duration_seconds'),
  expiresAtMs: integer('expires_at_ms'),
  localRevision: integer('local_revision').notNull().default(1),
  remoteRevision: integer('remote_revision'),
  activeManifestHash: text('active_manifest_hash'),
  approvedPreviewHash: text('approved_preview_hash'),
  accountClaimed: integer('account_claimed', { mode: 'boolean' }).notNull().default(false),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('shares_remote_public_id_unique').on(table.remotePublicId),
  index('shares_project_state_index').on(table.projectId, table.state, table.id),
  check('shares_title_check', sql`length(trim(${table.title})) BETWEEN 1 AND 160`),
  check('shares_description_check', sql`length(${table.description}) <= 10000`),
  check('shares_mutability_check', sql`${table.mutability} IN ('immutable','replaceable')`),
  check('shares_sync_mode_check', sql`${table.syncMode} IN ('manual','synchronized') AND (${table.mutability} = 'replaceable' OR ${table.syncMode} = 'manual')`),
  check('shares_visibility_check', sql`${table.visibility} IN ('public','unlisted','protected')`),
  check('shares_state_check', sql`${table.state} IN ('unpublished','preview-ready','publishing','synced','changes-pending','manual-update-available','failed','expired','grace-period','deleted')`),
  check('shares_expiration_check', sql`
    (${table.expirationType} = 'indefinite' AND ${table.expirationDurationSeconds} IS NULL AND ${table.expiresAtMs} IS NULL)
    OR (${table.expirationType} = 'duration' AND ${table.expirationDurationSeconds} BETWEEN 3600 AND 31536000 AND ${table.expiresAtMs} IS NULL)
    OR (${table.expirationType} = 'at' AND ${table.expirationDurationSeconds} IS NULL AND ${table.expiresAtMs} IS NOT NULL)
  `),
  check('shares_revision_check', sql`${table.localRevision} > 0 AND (${table.remoteRevision} IS NULL OR ${table.remoteRevision} > 0)`),
])

export const shareViews = sqliteTable('share_views', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  workspaceId: integer('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'restrict' }),
  viewType: text('view_type').notNull(),
  displayOrder: integer('display_order').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_views_share_workspace_unique').on(table.shareId, table.workspaceId),
  uniqueIndex('share_views_share_order_unique').on(table.shareId, table.displayOrder),
  check('share_views_type_check', sql`${table.viewType} IN ('systems','canvas')`),
  check('share_views_order_check', sql`${table.displayOrder} >= 0`),
])

export const shareFieldSelections = sqliteTable('share_field_selections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  definitionId: integer('definition_id').notNull().references(() => customFieldDefinitions.id, { onDelete: 'restrict' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [uniqueIndex('share_field_selections_unique').on(table.shareId, table.definitionId)])

export const shareTagSelections = sqliteTable('share_tag_selections', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id').notNull().references(() => inventoryTags.id, { onDelete: 'restrict' }),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [uniqueIndex('share_tag_selections_unique').on(table.shareId, table.tagId)])

export const shareResourceSnapshots = sqliteTable('share_resource_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  contentHash: text('content_hash').notNull(),
  payloadJson: text('payload_json').notNull(),
  capturedAtMs: integer('captured_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_resource_snapshots_hash_unique').on(table.shareId, table.contentHash),
  index('share_resource_snapshots_latest_index').on(table.shareId, table.capturedAtMs),
  check('share_resource_snapshots_payload_check', sql`json_valid(${table.payloadJson})`),
])

export const shareLocalBlobs = sqliteTable('share_local_blobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  contentHash: text('content_hash').notNull(),
  mediaType: text('media_type').notNull(),
  contentJson: text('content_json').notNull(),
  byteLength: integer('byte_length').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_local_blobs_hash_unique').on(table.contentHash),
  check('share_local_blobs_content_check', sql`json_valid(${table.contentJson}) AND ${table.byteLength} > 0`),
])

export const shareLocalRevisions = sqliteTable('share_local_revisions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  revision: integer('revision').notNull(),
  manifestHash: text('manifest_hash').notNull(),
  manifestJson: text('manifest_json').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_local_revisions_number_unique').on(table.shareId, table.revision),
  uniqueIndex('share_local_revisions_manifest_unique').on(table.shareId, table.manifestHash),
  check('share_local_revisions_revision_check', sql`${table.revision} > 0`),
  check('share_local_revisions_manifest_check', sql`json_valid(${table.manifestJson})`),
])

export const shareLocalRevisionBlobs = sqliteTable('share_local_revision_blobs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  localRevisionId: integer('local_revision_id').notNull().references(() => shareLocalRevisions.id, { onDelete: 'cascade' }),
  blobId: integer('blob_id').notNull().references(() => shareLocalBlobs.id, { onDelete: 'restrict' }),
}, (table) => [uniqueIndex('share_local_revision_blobs_unique').on(table.localRevisionId, table.blobId)])

export const sharePublicationOperations = sqliteTable('share_publication_operations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  shareId: integer('share_id').notNull().references(() => shares.id, { onDelete: 'cascade' }),
  localRevisionId: integer('local_revision_id').references(() => shareLocalRevisions.id, { onDelete: 'restrict' }),
  idempotencyKey: text('idempotency_key').notNull(),
  kind: text('kind').notNull(),
  state: text('state').notNull(),
  attemptCount: integer('attempt_count').notNull().default(0),
  availableAtMs: integer('available_at_ms').notNull(),
  remoteOperationId: integer('remote_operation_id'),
  lastErrorCode: text('last_error_code'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_publication_operations_idempotency_unique').on(table.idempotencyKey),
  index('share_publication_operations_queue_index').on(table.state, table.availableAtMs, table.id),
  check('share_publication_operations_kind_check', sql`${table.kind} IN ('publish','unpublish','delete','resource-snapshot')`),
  check('share_publication_operations_state_check', sql`${table.state} IN ('queued','running','retrying','succeeded','failed','cancelled')`),
  check('share_publication_operations_attempt_check', sql`${table.attemptCount} >= 0`),
  check('share_publication_operations_remote_id_check', sql`${table.remoteOperationId} IS NULL OR ${table.remoteOperationId} > 0`),
])
