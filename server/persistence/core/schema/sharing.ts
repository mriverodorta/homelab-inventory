import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { customFieldDefinitions, inventoryTags } from './inventory-metadata.ts'
import { projects, workspaces } from './projects.ts'
import { users } from './authentication.ts'

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
  lastConnectedAtMs: integer('last_connected_at_ms'),
  lastDisconnectedAtMs: integer('last_disconnected_at_ms'),
  lastRenewedAtMs: integer('last_renewed_at_ms'),
  eventLastErrorCode: text('event_last_error_code'),
  reconnectAttempt: integer('reconnect_attempt').notNull().default(0),
  nextReconnectAtMs: integer('next_reconnect_at_ms'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('sharing_settings_singleton_check', sql`${table.id} = 1`),
  check('sharing_settings_revision_check', sql`${table.revision} > 0`),
  check('sharing_settings_state_check', sql`${table.enrollmentState} IN ('pending','connected','retrying','recovery-pending','disabled','unsupported')`),
  check('sharing_settings_attempt_check', sql`${table.attemptCount} >= 0`),
  check('sharing_settings_cursor_check', sql`${table.remoteEventCursor} >= 0`),
  check('sharing_settings_recovery_check', sql`${table.recoveryState} IS NULL OR ${table.recoveryState} IN ('pending-owner-approval','approved')`),
  check('sharing_settings_reconnect_attempt_check', sql`${table.reconnectAttempt} >= 0`),
])

export const sharingEventLifecycle = sqliteTable('sharing_event_lifecycle', {
  id: integer('id').primaryKey(),
  pendingClaimId: text('pending_claim_id'),
  pendingClaimExpiresAtMs: integer('pending_claim_expires_at_ms'),
  accountLastReconciledAtMs: integer('account_last_reconciled_at_ms'),
  streamOpenCount: integer('stream_open_count').notNull().default(0),
  reconnectCount: integer('reconnect_count').notNull().default(0),
  credentialRefreshCount: integer('credential_refresh_count').notNull().default(0),
  dormantTransitionCount: integer('dormant_transition_count').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  check('sharing_event_lifecycle_singleton_check', sql`${table.id} = 1`),
  check('sharing_event_lifecycle_claim_check', sql`
    (${table.pendingClaimId} IS NULL AND ${table.pendingClaimExpiresAtMs} IS NULL)
    OR (
      ${table.pendingClaimId} IS NOT NULL
      AND length(${table.pendingClaimId}) BETWEEN 1 AND 128
      AND ${table.pendingClaimExpiresAtMs} > 0
    )
  `),
  check('sharing_event_lifecycle_reconciled_check', sql`${table.accountLastReconciledAtMs} IS NULL OR ${table.accountLastReconciledAtMs} > 0`),
  check('sharing_event_lifecycle_counter_check', sql`
    ${table.streamOpenCount} >= 0
    AND ${table.reconnectCount} >= 0
    AND ${table.credentialRefreshCount} >= 0
    AND ${table.dormantTransitionCount} >= 0
  `),
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
  accountClaimed: integer('account_claimed', { mode: 'boolean' }).notNull().default(false),
  githubUsername: text('github_username'),
  accountClaimedAtMs: integer('account_claimed_at_ms'),
  accountBindingRevision: integer('account_binding_revision').notNull().default(0),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('sharing_installation_projection_instance_unique').on(table.clientInstanceId),
  uniqueIndex('sharing_installation_projection_identity_unique').on(table.identityHash),
  check('sharing_installation_projection_singleton_check', sql`${table.id} = 1`),
  check('sharing_installation_projection_remote_id_check', sql`${table.remoteInstallationId} IS NULL OR ${table.remoteInstallationId} > 0`),
  check('sharing_installation_projection_state_check', sql`${table.state} IN ('local','active','recovery-pending','disabled')`),
  check('sharing_installation_projection_account_claimed_check', sql`${table.accountClaimed} IN (0,1)`),
  check('sharing_installation_projection_claimed_at_check', sql`${table.accountClaimedAtMs} IS NULL OR ${table.accountClaimedAtMs} > 0`),
  check('sharing_installation_projection_binding_revision_check', sql`${table.accountBindingRevision} >= 0`),
])

export const sharingAccountOperations = sqliteTable('sharing_account_operations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  clientAttemptId: text('client_attempt_id').notNull(),
  remoteIdempotencyKey: text('remote_idempotency_key').notNull(),
  shareDisposition: text('share_disposition').notNull(),
  expectedAccountBindingRevision: integer('expected_account_binding_revision').notNull(),
  state: text('state').notNull().default('pending'),
  resultJson: text('result_json'),
  lastErrorCode: text('last_error_code'),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('sharing_account_operations_client_attempt_unique').on(table.clientAttemptId),
  uniqueIndex('sharing_account_operations_remote_key_unique').on(table.remoteIdempotencyKey),
  index('sharing_account_operations_state_index').on(table.state, table.updatedAtMs, table.id),
  check('sharing_account_operations_disposition_check', sql`${table.shareDisposition} IN ('keep','unpublish','delete')`),
  check('sharing_account_operations_revision_check', sql`${table.expectedAccountBindingRevision} >= 0`),
  check('sharing_account_operations_state_check', sql`${table.state} IN ('pending','retrying','succeeded','failed')`),
  check('sharing_account_operations_result_check', sql`${table.resultJson} IS NULL OR json_valid(${table.resultJson})`),
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
  embedEnabled: integer('embed_enabled', { mode: 'boolean' }).notNull().default(false),
  embedOriginsJson: text('embed_origins_json').notNull().default('[]'),
  resourceSnapshotIncluded: integer('resource_snapshot_included', { mode: 'boolean' }).notNull().default(false),
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
  check('shares_embed_origins_check', sql`json_valid(${table.embedOriginsJson}) AND json_type(${table.embedOriginsJson}) = 'array'`),
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
  expectedRemoteRevision: integer('expected_remote_revision'),
  remoteOperationState: text('remote_operation_state'),
  remoteFailureCode: text('remote_failure_code'),
  remoteMissingHashesJson: text('remote_missing_hashes_json'),
  activationRevisionId: integer('activation_revision_id'),
  predatesMigration0035: integer('predates_migration_0035').notNull().default(0),
  revisionIntentProvenance: text('revision_intent_provenance').notNull().default('exact'),
  lastErrorCode: text('last_error_code'),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('share_publication_operations_idempotency_unique').on(table.idempotencyKey),
  index('share_publication_operations_queue_index').on(table.state, table.availableAtMs, table.id),
  index('share_publication_operations_runnable_index').on(table.revisionIntentProvenance, table.state, table.availableAtMs, table.id),
  check('share_publication_operations_kind_check', sql`${table.kind} IN ('publish','unpublish','delete','resource-snapshot')`),
  check('share_publication_operations_state_check', sql`${table.state} IN ('queued','running','retrying','succeeded','failed','cancelled')`),
  check('share_publication_operations_attempt_check', sql`${table.attemptCount} >= 0`),
  check('share_publication_operations_remote_id_check', sql`${table.remoteOperationId} IS NULL OR ${table.remoteOperationId} > 0`),
  check('share_publication_operations_expected_revision_check', sql`${table.expectedRemoteRevision} IS NULL OR ${table.expectedRemoteRevision} >= 0`),
  check('share_publication_operations_remote_state_check', sql`${table.remoteOperationState} IS NULL OR ${table.remoteOperationState} IN ('staged','ready','active','failed')`),
  check('share_publication_operations_remote_hashes_check', sql`${table.remoteMissingHashesJson} IS NULL OR (json_valid(${table.remoteMissingHashesJson}) AND json_type(${table.remoteMissingHashesJson}) = 'array')`),
  check('share_publication_operations_activation_revision_check', sql`${table.activationRevisionId} IS NULL OR ${table.activationRevisionId} > 0`),
  check('share_publication_operations_predates_migration_check', sql`${table.predatesMigration0035} IN (0, 1)`),
  check('share_publication_operations_intent_provenance_check', sql`${table.revisionIntentProvenance} IN ('exact','safe-backfill','reconciliation-required')`),
])
