import { createHash } from 'node:crypto'
import type { RepositoryContext } from './repository-context.ts'
import { assertPositiveId } from './repository-context.ts'

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

export type SharingEnrollmentState = 'pending' | 'connected' | 'retrying' | 'recovery-pending' | 'disabled' | 'unsupported'
export type ShareState = 'unpublished' | 'preview-ready' | 'publishing' | 'synced' | 'changes-pending' | 'manual-update-available' | 'failed' | 'expired' | 'grace-period' | 'deleted'
export type ShareDisposition = 'keep' | 'unpublish' | 'delete'
export type SharingSettings = Readonly<{
  id: 1
  revision: number
  connectionEnabled: boolean
  enrollmentState: SharingEnrollmentState
  attemptCount: number
  nextAttemptAtMs: number | null
  lastErrorCode: string | null
  remoteEventCursor: number
  recoveryState: 'pending-owner-approval' | 'approved' | null
  createdAtMs: number
  updatedAtMs: number
}>

export type SharingInstallationProjection = Readonly<{
  id: 1
  clientInstanceId: string
  keyId: string
  publicKeySpki: string
  identityHash: string
  remoteInstallationId: number | null
  credentialExpiresAtMs: number | null
  state: 'local' | 'active' | 'recovery-pending' | 'disabled'
  recoveryPublicKeySpki: string | null
  accountClaimed: boolean
  githubUsername: string | null
  accountClaimedAtMs: number | null
  accountBindingRevision: number
  createdAtMs: number
  updatedAtMs: number
}>

export type AccountUnlinkResult = Readonly<{
  account: Readonly<{ connected: false; githubUsername: null; bindingRevision: number }>
  disposition: ShareDisposition
  affected: Readonly<{ shares: number; keptOnline: number; unpublished: number; deleted: number }>
}>

export type SharingAccountOperation = Readonly<{
  id: number
  clientAttemptId: string
  remoteIdempotencyKey: string
  shareDisposition: ShareDisposition
  expectedAccountBindingRevision: number
  state: 'pending' | 'retrying' | 'succeeded' | 'failed'
  result: Readonly<{ result: AccountUnlinkResult; sharesReconciled: boolean; affectedLocalShares: number }> | null
  lastErrorCode: string | null
  actorUserId: number | null
  createdAtMs: number
  updatedAtMs: number
}>

export type ShareRecord = Readonly<{
  id: number
  projectId: number
  remotePublicId: string | null
  title: string
  description: string
  mutability: 'immutable' | 'replaceable'
  syncMode: 'manual' | 'synchronized'
  visibility: 'public' | 'unlisted' | 'protected'
  state: ShareState
  commentsEnabled: boolean
  reactionsEnabled: boolean
  embedEnabled: boolean
  embedOrigins: readonly string[]
  resourceSnapshotIncluded: boolean
  expirationType: 'indefinite' | 'duration' | 'at'
  expirationDurationSeconds: number | null
  expiresAtMs: number | null
  localRevision: number
  remoteRevision: number | null
  activeManifestHash: string | null
  approvedPreviewHash: string | null
  accountClaimed: boolean
  createdAtMs: number
  updatedAtMs: number
}>

export type SharingRemoteEvent = Readonly<{
  id: number
  kind: 'publication' | 'replacement' | 'unpublish' | 'deletion' | 'expiration' | 'grace-period' | 'account-claim' | 'recovery'
  payload: Readonly<Record<string, unknown>>
}>

type ShareInput = Readonly<{
  projectId: number
  title: string
  description?: string
  mutability: 'immutable' | 'replaceable'
  syncMode: 'manual' | 'synchronized'
  visibility: 'public' | 'unlisted' | 'protected'
  commentsEnabled?: boolean
  reactionsEnabled?: boolean
  embed?: Readonly<{ enabled: false } | { enabled: true; origins: readonly string[] }>
  resourceSnapshotIncluded?: boolean
  expiration?: Readonly<
    | { type: 'indefinite' }
    | { type: 'duration'; durationSeconds: number }
    | { type: 'at'; expiresAtMs: number }
  >
  views: readonly Readonly<{ workspaceId: number; viewType: 'systems' | 'canvas' }>[]
  fieldDefinitionIds?: readonly number[]
  tagIds?: readonly number[]
}>

type EnrollmentPatch = Readonly<{
  enrollmentState: SharingEnrollmentState
  attemptCount?: number
  nextAttemptAtMs?: number | null
  lastErrorCode?: string | null
  remoteEventCursor?: number
  recoveryState?: 'pending-owner-approval' | 'approved' | null
}>

type ProjectionInput = Omit<SharingInstallationProjection,
  'id' | 'accountClaimed' | 'githubUsername' | 'accountClaimedAtMs' | 'accountBindingRevision' | 'createdAtMs' | 'updatedAtMs'
>

const settingColumns = `
  id, revision, connection_enabled AS connectionEnabled,
  enrollment_state AS enrollmentState, attempt_count AS attemptCount,
  next_attempt_at_ms AS nextAttemptAtMs, last_error_code AS lastErrorCode,
  remote_event_cursor AS remoteEventCursor, recovery_state AS recoveryState,
  created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs
`

const projectionColumns = `
  id, client_instance_id AS clientInstanceId, key_id AS keyId,
  public_key_spki AS publicKeySpki, identity_hash AS identityHash,
  remote_installation_id AS remoteInstallationId,
  credential_expires_at_ms AS credentialExpiresAtMs, state,
  recovery_public_key_spki AS recoveryPublicKeySpki,
  account_claimed AS accountClaimed, github_username AS githubUsername,
  account_claimed_at_ms AS accountClaimedAtMs,
  account_binding_revision AS accountBindingRevision,
  created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs
`

const accountOperationColumns = `
  id, client_attempt_id AS clientAttemptId,
  remote_idempotency_key AS remoteIdempotencyKey,
  share_disposition AS shareDisposition,
  expected_account_binding_revision AS expectedAccountBindingRevision,
  state, result_json AS resultJson, last_error_code AS lastErrorCode,
  actor_user_id AS actorUserId, created_at_ms AS createdAtMs,
  updated_at_ms AS updatedAtMs
`

const shareColumns = `
  id, project_id AS projectId, remote_public_id AS remotePublicId, title,
  description, mutability, sync_mode AS syncMode, visibility, state,
  comments_enabled AS commentsEnabled, reactions_enabled AS reactionsEnabled,
  embed_enabled AS embedEnabled, embed_origins_json AS embedOriginsJson,
  resource_snapshot_included AS resourceSnapshotIncluded,
  expiration_type AS expirationType,
  expiration_duration_seconds AS expirationDurationSeconds,
  expires_at_ms AS expiresAtMs, local_revision AS localRevision,
  remote_revision AS remoteRevision, active_manifest_hash AS activeManifestHash,
  approved_preview_hash AS approvedPreviewHash, account_claimed AS accountClaimed,
  created_at_ms AS createdAtMs, updated_at_ms AS updatedAtMs
`

export function createSharingRepository(context: RepositoryContext) {
  const { sqlite, now } = context

  function getSettings(): SharingSettings {
    const row = sqlite.query(`SELECT ${settingColumns} FROM sharing_settings WHERE id = 1`).get() as Record<string, unknown> | null
    if (!row) throw new Error('Sharing settings are missing.')
    return booleans(row, ['connectionEnabled']) as SharingSettings
  }

  function setConnectionEnabled(expectedRevision: number, enabled: boolean) {
    assertPositiveId(expectedRevision, 'Sharing settings revision')
    const at = now()
    const state = enabled ? 'pending' : 'disabled'
    const result = sqlite.query(`
      UPDATE sharing_settings
      SET connection_enabled = ?, enrollment_state = ?, attempt_count = 0,
          next_attempt_at_ms = NULL, last_error_code = NULL,
          recovery_state = NULL, revision = revision + 1, updated_at_ms = ?
      WHERE id = 1 AND revision = ?
    `).run(enabled ? 1 : 0, state, at, expectedRevision)
    if (result.changes !== 1) throw new Error('Sharing settings revision conflict.')
    return getSettings()
  }

  function updateEnrollment(patch: EnrollmentPatch) {
    const current = getSettings()
    const attemptCount = patch.attemptCount ?? current.attemptCount
    const eventCursor = patch.remoteEventCursor ?? current.remoteEventCursor
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) throw new Error('Sharing attempt count must be a non-negative safe integer.')
    if (!Number.isSafeInteger(eventCursor) || eventCursor < 0) throw new Error('Sharing event cursor must be a non-negative safe integer.')
    sqlite.query(`
      UPDATE sharing_settings
      SET enrollment_state = ?, attempt_count = ?, next_attempt_at_ms = ?,
          last_error_code = ?, remote_event_cursor = ?, recovery_state = ?,
          revision = revision + 1, updated_at_ms = ?
      WHERE id = 1
    `).run(
      patch.enrollmentState,
      attemptCount,
      patch.nextAttemptAtMs === undefined ? current.nextAttemptAtMs : patch.nextAttemptAtMs,
      patch.lastErrorCode === undefined ? current.lastErrorCode : patch.lastErrorCode,
      eventCursor,
      patch.recoveryState === undefined ? current.recoveryState : patch.recoveryState,
      now(),
    )
    return getSettings()
  }

  function getInstallationProjection(): SharingInstallationProjection | null {
    const row = sqlite.query(`SELECT ${projectionColumns} FROM sharing_installation_projection WHERE id = 1`).get() as Record<string, unknown> | null
    return row ? booleans(row, ['accountClaimed']) as SharingInstallationProjection : null
  }

  function reconcileInstallationAccount(
    status: Readonly<{ claimed: boolean; githubUsername: string | null; accountClaimedAtMs: number | null; accountBindingRevision?: number }>,
    eventCursor?: number,
  ) {
    const validUsername = status.githubUsername === null || /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u.test(status.githubUsername)
    const validClaimedAt = status.accountClaimedAtMs === null || (Number.isSafeInteger(status.accountClaimedAtMs) && status.accountClaimedAtMs > 0)
    const validBindingRevision = status.accountBindingRevision === undefined || (Number.isSafeInteger(status.accountBindingRevision) && status.accountBindingRevision >= 0)
    if (typeof status.claimed !== 'boolean' || !validUsername || !validClaimedAt || !validBindingRevision) throw new Error('Sharing installation account status is invalid.')
    if (eventCursor !== undefined && (!Number.isSafeInteger(eventCursor) || eventCursor <= 0)) throw new Error('Sharing event cursor is invalid.')
    return sqlite.transaction(() => {
      const current = getInstallationProjection()
      if (!current) throw new Error('Sharing installation projection is missing.')
      const bindingRevision = status.accountBindingRevision ?? current.accountBindingRevision
      if (bindingRevision < current.accountBindingRevision) throw new Error('Sharing account binding revision cannot move backward.')
      sqlite.query('UPDATE sharing_installation_projection SET account_claimed = ?, github_username = ?, account_claimed_at_ms = ?, account_binding_revision = ?, updated_at_ms = ? WHERE id = 1').run(
        status.claimed ? 1 : 0,
        status.claimed ? status.githubUsername : null,
        status.claimed ? status.accountClaimedAtMs : null,
        bindingRevision,
        now(),
      )
      if (eventCursor !== undefined && eventCursor > getSettings().remoteEventCursor) {
        sqlite.query('UPDATE sharing_settings SET remote_event_cursor = ?, revision = revision + 1, updated_at_ms = ? WHERE id = 1').run(eventCursor, now())
      }
      return getInstallationProjection()!
    })()
  }

  function saveInstallationProjection(input: ProjectionInput) {
    if (!input.clientInstanceId || !input.keyId || !input.publicKeySpki || !/^[0-9a-f]{64}$/u.test(input.identityHash)) {
      throw new Error('Sharing installation projection is invalid.')
    }
    if (input.remoteInstallationId != null) assertPositiveId(input.remoteInstallationId, 'Remote installation ID')
    const at = now()
    sqlite.query(`
      INSERT INTO sharing_installation_projection (
        id, client_instance_id, key_id, public_key_spki, identity_hash,
        remote_installation_id, credential_expires_at_ms, state,
        recovery_public_key_spki, created_at_ms, updated_at_ms
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        client_instance_id = excluded.client_instance_id,
        key_id = excluded.key_id,
        public_key_spki = excluded.public_key_spki,
        identity_hash = excluded.identity_hash,
        remote_installation_id = excluded.remote_installation_id,
        credential_expires_at_ms = excluded.credential_expires_at_ms,
        state = excluded.state,
        recovery_public_key_spki = excluded.recovery_public_key_spki,
        updated_at_ms = excluded.updated_at_ms
    `).run(
      input.clientInstanceId, input.keyId, input.publicKeySpki, input.identityHash,
      input.remoteInstallationId, input.credentialExpiresAtMs, input.state,
      input.recoveryPublicKeySpki, at, at,
    )
    return getInstallationProjection()!
  }

  function deleteInstallationProjection() {
    sqlite.query('DELETE FROM sharing_installation_projection WHERE id = 1').run()
  }

  function accountOperation(row: Record<string, unknown> | null): SharingAccountOperation | null {
    if (!row) return null
    const result = row.resultJson == null ? null : JSON.parse(String(row.resultJson))
    const { resultJson: _resultJson, ...operation } = row
    return { ...operation, result } as unknown as SharingAccountOperation
  }

  function getAccountOperation(id: number) {
    assertPositiveId(id, 'Sharing account operation ID')
    return accountOperation(sqlite.query(`SELECT ${accountOperationColumns} FROM sharing_account_operations WHERE id = ?`).get(id) as Record<string, unknown> | null)
  }

  function prepareAccountUnlink(input: Readonly<{
    clientAttemptId: string
    remoteIdempotencyKey: string
    expectedAccountBindingRevision: number
    shareDisposition: ShareDisposition
    actorUserId: number | null
  }>) {
    if (!UUID_V4_PATTERN.test(input.clientAttemptId)) throw new Error('Sharing account unlink attempt ID is invalid.')
    const existing = accountOperation(sqlite.query(`SELECT ${accountOperationColumns} FROM sharing_account_operations WHERE client_attempt_id = ?`).get(input.clientAttemptId) as Record<string, unknown> | null)
    if (existing) {
      if (existing.expectedAccountBindingRevision !== input.expectedAccountBindingRevision || existing.shareDisposition !== input.shareDisposition) {
        throw new Error('Sharing account unlink attempt conflict.')
      }
      return existing
    }
    if (!UUID_V4_PATTERN.test(input.remoteIdempotencyKey)) throw new Error('Sharing account unlink idempotency key is invalid.')
    if (!Number.isSafeInteger(input.expectedAccountBindingRevision) || input.expectedAccountBindingRevision < 0) throw new Error('Sharing account binding revision is invalid.')
    if (!['keep', 'unpublish', 'delete'].includes(input.shareDisposition)) throw new Error('Sharing account unlink disposition is invalid.')
    if (input.actorUserId != null) assertPositiveId(input.actorUserId, 'Sharing account unlink actor ID')
    const projection = getInstallationProjection()
    if (!projection?.accountClaimed) throw new Error('Sharing installation has no linked account.')
    if (projection.accountBindingRevision !== input.expectedAccountBindingRevision) throw new Error('Sharing account binding revision conflict.')
    const at = now()
    const row = sqlite.query(`
      INSERT INTO sharing_account_operations (
        client_attempt_id, remote_idempotency_key, share_disposition,
        expected_account_binding_revision, actor_user_id, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id
    `).get(input.clientAttemptId, input.remoteIdempotencyKey, input.shareDisposition, input.expectedAccountBindingRevision, input.actorUserId, at, at) as { id: number }
    return getAccountOperation(row.id)!
  }

  function markAccountUnlinkRetryable(id: number, errorCode: string) {
    assertPositiveId(id, 'Sharing account operation ID')
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(errorCode)) throw new Error('Sharing account unlink error code is invalid.')
    const changed = sqlite.query("UPDATE sharing_account_operations SET state = 'retrying', last_error_code = ?, updated_at_ms = ? WHERE id = ? AND state IN ('pending','retrying')").run(errorCode, now(), id).changes
    if (changed !== 1) throw new Error('Sharing account unlink operation cannot be retried.')
    return getAccountOperation(id)!
  }

  function failAccountUnlink(id: number, errorCode: string) {
    assertPositiveId(id, 'Sharing account operation ID')
    if (!/^[a-z0-9][a-z0-9-]{0,127}$/u.test(errorCode)) throw new Error('Sharing account unlink error code is invalid.')
    const changed = sqlite.query("UPDATE sharing_account_operations SET state = 'failed', last_error_code = ?, updated_at_ms = ? WHERE id = ? AND state IN ('pending','retrying')").run(errorCode, now(), id).changes
    if (changed !== 1) throw new Error('Sharing account unlink operation cannot fail from its current state.')
    return getAccountOperation(id)!
  }

  function completeAccountUnlink(input: Readonly<{ operationId: number; actorUserId: number | null; result: AccountUnlinkResult }>) {
    assertPositiveId(input.operationId, 'Sharing account operation ID')
    if (input.actorUserId != null) assertPositiveId(input.actorUserId, 'Sharing account unlink actor ID')
    return sqlite.transaction(() => {
      const operation = getAccountOperation(input.operationId)
      if (!operation) throw new Error('Sharing account unlink operation does not exist.')
      const result = normalizeAccountUnlinkResult(input.result, operation)
      if (operation.state === 'succeeded') {
        if (JSON.stringify(operation.result?.result) !== JSON.stringify(result)) throw new Error('Sharing account unlink replay result conflict.')
        return operation.result!
      }
      if (!['pending', 'retrying'].includes(operation.state)) throw new Error('Sharing account unlink operation cannot be completed from its current state.')
      const projection = getInstallationProjection()
      if (!projection) throw new Error('Sharing installation projection is missing.')
      if (projection.accountBindingRevision !== operation.expectedAccountBindingRevision || result.account.bindingRevision !== operation.expectedAccountBindingRevision + 1) {
        throw new Error('Sharing account unlink binding revision conflict.')
      }
      const affectedLocalShares = Number((sqlite.query("SELECT count(*) AS count FROM shares WHERE remote_public_id IS NOT NULL AND state <> 'deleted'").get() as { count: number }).count)
      const sharesReconciled = affectedLocalShares === result.affected.shares
      if (sharesReconciled && operation.shareDisposition === 'unpublish') {
        sqlite.query("UPDATE shares SET state = 'unpublished', updated_at_ms = ? WHERE remote_public_id IS NOT NULL AND state <> 'deleted'").run(now())
      } else if (sharesReconciled && operation.shareDisposition === 'delete') {
        sqlite.query("UPDATE shares SET state = 'deleted', active_manifest_hash = NULL, approved_preview_hash = NULL, updated_at_ms = ? WHERE remote_public_id IS NOT NULL AND state <> 'deleted'").run(now())
      }
      sqlite.query(`
        UPDATE sharing_installation_projection
        SET account_claimed = 0, github_username = NULL, account_claimed_at_ms = NULL,
            account_binding_revision = ?, updated_at_ms = ? WHERE id = 1
      `).run(result.account.bindingRevision, now())
      const stored = { result, sharesReconciled, affectedLocalShares }
      sqlite.query("UPDATE sharing_account_operations SET state = 'succeeded', result_json = ?, last_error_code = NULL, actor_user_id = ?, updated_at_ms = ? WHERE id = ?")
        .run(JSON.stringify(stored), input.actorUserId, now(), operation.id)
      sqlite.query(`
        INSERT INTO security_events (user_id, actor_user_id, type, target, details_json, created_at_ms)
        VALUES (NULL, ?, 'sharing-account-unlinked', ?, ?, ?)
      `).run(input.actorUserId, String(projection.remoteInstallationId ?? projection.clientInstanceId), JSON.stringify({
        disposition: result.disposition,
        affected: result.affected,
        sharesReconciled,
        bindingRevision: result.account.bindingRevision,
      }), now())
      return stored
    })()
  }

  function createShare(input: ShareInput) {
    assertPositiveId(input.projectId, 'Project ID')
    if (!input.views.length) throw new Error('A share must include at least one view.')
    const at = now()
    const expiration = input.expiration ?? { type: 'indefinite' as const }
    return sqlite.transaction(() => {
      const row = sqlite.query(`
        INSERT INTO shares (
          project_id, title, description, mutability, sync_mode, visibility,
          comments_enabled, reactions_enabled, embed_enabled, embed_origins_json,
          resource_snapshot_included, expiration_type,
          expiration_duration_seconds, expires_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
      `).get(
        input.projectId, input.title.trim(), input.description ?? '', input.mutability,
        input.syncMode, input.visibility, input.commentsEnabled ? 1 : 0,
        input.reactionsEnabled ? 1 : 0, input.embed?.enabled ? 1 : 0,
        JSON.stringify(input.embed?.enabled ? normalizedOrigins(input.embed.origins) : []),
        input.resourceSnapshotIncluded ? 1 : 0, expiration.type,
        expiration.type === 'duration' ? expiration.durationSeconds : null,
        expiration.type === 'at' ? expiration.expiresAtMs : null, at, at,
      ) as { id: number }
      input.views.forEach((view, displayOrder) => {
        assertPositiveId(view.workspaceId, 'Workspace ID')
        sqlite.query(`INSERT INTO share_views (share_id, workspace_id, view_type, display_order, created_at_ms) VALUES (?, ?, ?, ?, ?)`)
          .run(row.id, view.workspaceId, view.viewType, displayOrder, at)
      })
      for (const definitionId of uniqueIds(input.fieldDefinitionIds ?? [], 'Custom field definition ID')) {
        sqlite.query('INSERT INTO share_field_selections (share_id, definition_id, created_at_ms) VALUES (?, ?, ?)').run(row.id, definitionId, at)
      }
      for (const tagId of uniqueIds(input.tagIds ?? [], 'Tag ID')) {
        sqlite.query('INSERT INTO share_tag_selections (share_id, tag_id, created_at_ms) VALUES (?, ?, ?)').run(row.id, tagId, at)
      }
      return getShare(row.id)!
    })()
  }

  function getShare(id: number): ShareRecord | null {
    assertPositiveId(id, 'Share ID')
    const row = sqlite.query(`SELECT ${shareColumns} FROM shares WHERE id = ?`).get(id) as Record<string, unknown> | null
    return row ? mapShare(row, getInstallationProjection()?.accountClaimed ?? false) : null
  }

  function getShareByRemotePublicId(publicId: string): ShareRecord | null {
    if (!/^[A-Za-z0-9_-]{1,128}$/u.test(publicId)) throw new Error('Remote share ID is invalid.')
    const row = sqlite.query(`SELECT ${shareColumns} FROM shares WHERE remote_public_id = ?`).get(publicId) as Record<string, unknown> | null
    return row ? mapShare(row, getInstallationProjection()?.accountClaimed ?? false) : null
  }

  function applyRemoteEvent(event: SharingRemoteEvent) {
    assertPositiveId(event.id, 'Remote event cursor')
    return sqlite.transaction(() => {
      const settings = getSettings()
      if (event.id <= settings.remoteEventCursor) return { applied: false, shares: [] as ShareRecord[] }
      const changedIds: number[] = []
      if (event.kind === 'account-claim') throw new Error('Account claim events require signed account status reconciliation.')
      else if (event.kind === 'recovery') {
        const state = event.payload.state === 'active' ? 'active' : event.payload.state === 'recovery-pending' ? 'recovery-pending' : event.payload.state === 'revoked' ? 'disabled' : null
        if (!state) throw new Error('Remote recovery event state is invalid.')
        sqlite.query('UPDATE sharing_installation_projection SET state = ?, updated_at_ms = ? WHERE id = 1').run(state, now())
      } else {
        const publicId = String(event.payload.sharePublicId ?? '')
        const revision = Number(event.payload.revision)
        const state = remoteShareState(event.payload.state)
        if (!Number.isSafeInteger(revision) || revision <= 0) throw new Error('Remote share event revision is invalid.')
        const share = getShareByRemotePublicId(publicId)
        if (share && (share.remoteRevision == null || revision > share.remoteRevision)) {
          sqlite.query(`UPDATE shares SET state = ?, remote_revision = ?, local_revision = local_revision + 1, updated_at_ms = ? WHERE id = ?`).run(state, revision, now(), share.id)
          changedIds.push(share.id)
        }
      }
      sqlite.query(`UPDATE sharing_settings SET remote_event_cursor = ?, revision = revision + 1, updated_at_ms = ? WHERE id = 1`).run(event.id, now())
      return { applied: true, shares: changedIds.map((id) => getShare(id)!).filter(Boolean) }
    })()
  }

  function listShares(projectId?: number) {
    if (projectId != null) assertPositiveId(projectId, 'Project ID')
    const rows = projectId == null
      ? sqlite.query(`SELECT ${shareColumns} FROM shares WHERE state <> 'deleted' ORDER BY updated_at_ms DESC, id DESC`).all()
      : sqlite.query(`SELECT ${shareColumns} FROM shares WHERE project_id = ? AND state <> 'deleted' ORDER BY updated_at_ms DESC, id DESC`).all(projectId)
    const accountClaimed = getInstallationProjection()?.accountClaimed ?? false
    return rows.map((row) => mapShare(row as Record<string, unknown>,accountClaimed))
  }

  function getShareConfiguration(id: number) {
    const share = getShare(id)
    if (!share) return null
    return {
      share,
      views: sqlite.query('SELECT id, workspace_id AS workspaceId, view_type AS viewType, display_order AS displayOrder FROM share_views WHERE share_id = ? ORDER BY display_order, id').all(id),
      fieldDefinitionIds: (sqlite.query('SELECT definition_id AS id FROM share_field_selections WHERE share_id = ? ORDER BY definition_id').all(id) as { id: number }[]).map(({ id }) => id),
      tagIds: (sqlite.query('SELECT tag_id AS id FROM share_tag_selections WHERE share_id = ? ORDER BY tag_id').all(id) as { id: number }[]).map(({ id }) => id),
    }
  }

  function updateShareConfiguration(id: number, expectedRevision: number, input: ShareInput) {
    assertPositiveId(id, 'Share ID')
    assertPositiveId(expectedRevision, 'Share revision')
    assertPositiveId(input.projectId, 'Project ID')
    if (!input.views.length) throw new Error('A share must include at least one view.')
    const current = getShare(id)
    if (!current) throw new Error(`Share ${id} does not exist.`)
    if (current.projectId !== input.projectId) throw new Error('A share cannot be moved to another project.')
    const at = now()
    const expiration = input.expiration ?? { type: 'indefinite' as const }
    const nextState = current.remoteRevision == null
      ? 'unpublished'
      : input.mutability === 'replaceable' && input.syncMode === 'synchronized'
        ? 'changes-pending'
        : 'manual-update-available'
    return sqlite.transaction(() => {
      const result = sqlite.query(`
        UPDATE shares SET title = ?, description = ?, mutability = ?, sync_mode = ?,
          visibility = ?, comments_enabled = ?, reactions_enabled = ?, embed_enabled = ?,
          embed_origins_json = ?, resource_snapshot_included = ?, expiration_type = ?,
          expiration_duration_seconds = ?, expires_at_ms = ?, state = ?,
          approved_preview_hash = NULL, local_revision = local_revision + 1,
          updated_at_ms = ?
        WHERE id = ? AND local_revision = ?
      `).run(
        input.title.trim(), input.description ?? '', input.mutability, input.syncMode,
        input.visibility, input.commentsEnabled ? 1 : 0, input.reactionsEnabled ? 1 : 0,
        input.embed?.enabled ? 1 : 0,
        JSON.stringify(input.embed?.enabled ? normalizedOrigins(input.embed.origins) : []),
        input.resourceSnapshotIncluded ? 1 : 0, expiration.type,
        expiration.type === 'duration' ? expiration.durationSeconds : null,
        expiration.type === 'at' ? expiration.expiresAtMs : null,
        nextState, at, id, expectedRevision,
      )
      if (result.changes !== 1) throw new Error('Share revision conflict.')
      sqlite.query('DELETE FROM share_views WHERE share_id = ?').run(id)
      sqlite.query('DELETE FROM share_field_selections WHERE share_id = ?').run(id)
      sqlite.query('DELETE FROM share_tag_selections WHERE share_id = ?').run(id)
      input.views.forEach((view, displayOrder) => {
        assertPositiveId(view.workspaceId, 'Workspace ID')
        sqlite.query('INSERT INTO share_views (share_id, workspace_id, view_type, display_order, created_at_ms) VALUES (?, ?, ?, ?, ?)')
          .run(id, view.workspaceId, view.viewType, displayOrder, at)
      })
      for (const definitionId of uniqueIds(input.fieldDefinitionIds ?? [], 'Custom field definition ID')) {
        sqlite.query('INSERT INTO share_field_selections (share_id, definition_id, created_at_ms) VALUES (?, ?, ?)').run(id, definitionId, at)
      }
      for (const tagId of uniqueIds(input.tagIds ?? [], 'Tag ID')) {
        sqlite.query('INSERT INTO share_tag_selections (share_id, tag_id, created_at_ms) VALUES (?, ?, ?)').run(id, tagId, at)
      }
      return getShareConfiguration(id)!
    })()
  }

  function updateShare(id: number, expectedRevision: number, patch: Partial<Pick<ShareRecord,
    'remotePublicId' | 'state' | 'remoteRevision' | 'activeManifestHash' | 'approvedPreviewHash' | 'accountClaimed'
  >>) {
    assertPositiveId(id, 'Share ID')
    assertPositiveId(expectedRevision, 'Share revision')
    const current = getShare(id)
    if (!current) throw new Error(`Share ${id} does not exist.`)
    const result = sqlite.query(`
      UPDATE shares SET remote_public_id = ?, state = ?, remote_revision = ?,
        active_manifest_hash = ?, approved_preview_hash = ?, account_claimed = ?,
        local_revision = local_revision + 1, updated_at_ms = ?
      WHERE id = ? AND local_revision = ?
    `).run(
      patch.remotePublicId === undefined ? current.remotePublicId : patch.remotePublicId,
      patch.state ?? current.state,
      patch.remoteRevision === undefined ? current.remoteRevision : patch.remoteRevision,
      patch.activeManifestHash === undefined ? current.activeManifestHash : patch.activeManifestHash,
      patch.approvedPreviewHash === undefined ? current.approvedPreviewHash : patch.approvedPreviewHash,
      patch.accountClaimed === undefined ? (current.accountClaimed ? 1 : 0) : (patch.accountClaimed ? 1 : 0),
      now(), id, expectedRevision,
    )
    if (result.changes !== 1) throw new Error('Share revision conflict.')
    return getShare(id)!
  }

  function persistRevision(input: Readonly<{
    shareId: number
    revision: number
    manifestHash: string
    manifestJson: string
    blobs: readonly Readonly<{ contentHash: string; mediaType: string; contentJson: string }>[]
  }>) {
    assertPositiveId(input.shareId, 'Share ID')
    assertPositiveId(input.revision, 'Local share revision')
    JSON.parse(input.manifestJson)
    const at = now()
    return sqlite.transaction(() => {
      const existing = sqlite.query('SELECT id, manifest_json AS manifestJson FROM share_local_revisions WHERE share_id = ? AND manifest_hash = ?')
        .get(input.shareId, input.manifestHash) as { id: number; manifestJson: string } | null
      if (existing) {
        if (existing.manifestJson !== input.manifestJson) throw new Error('Manifest hash collision detected.')
        return existing.id
      }
      const revision = sqlite.query(`
        INSERT INTO share_local_revisions (share_id, revision, manifest_hash, manifest_json, created_at_ms)
        VALUES (?, ?, ?, ?, ?) RETURNING id
      `).get(input.shareId, input.revision, input.manifestHash, input.manifestJson, at) as { id: number }
      for (const blob of input.blobs) {
        JSON.parse(blob.contentJson)
        const byteLength = Buffer.byteLength(blob.contentJson)
        const calculated = createHash('sha256').update(blob.contentJson).digest('hex')
        if (calculated !== blob.contentHash) throw new Error(`Share blob ${blob.contentHash} does not match its content.`)
        sqlite.query(`
          INSERT INTO share_local_blobs (content_hash, media_type, content_json, byte_length, created_at_ms)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(content_hash) DO NOTHING
        `).run(blob.contentHash, blob.mediaType, blob.contentJson, byteLength, at)
        const stored = sqlite.query('SELECT id, content_json AS contentJson FROM share_local_blobs WHERE content_hash = ?').get(blob.contentHash) as { id: number; contentJson: string }
        if (stored.contentJson !== blob.contentJson) throw new Error('Share blob hash collision detected.')
        sqlite.query('INSERT INTO share_local_revision_blobs (local_revision_id, blob_id) VALUES (?, ?)').run(revision.id, stored.id)
      }
      return revision.id
    })()
  }

  function getLocalRevision(id: number) {
    assertPositiveId(id, 'Local share revision ID')
    const revision = sqlite.query(`SELECT id, share_id AS shareId, revision, manifest_hash AS manifestHash, manifest_json AS manifestJson, created_at_ms AS createdAtMs FROM share_local_revisions WHERE id = ?`).get(id)
    if (!revision) return null
    return {
      ...revision as Record<string, unknown>,
      blobs: sqlite.query(`
        SELECT b.id, b.content_hash AS contentHash, b.media_type AS mediaType,
          b.content_json AS contentJson, b.byte_length AS byteLength
        FROM share_local_revision_blobs rb
        JOIN share_local_blobs b ON b.id = rb.blob_id
        WHERE rb.local_revision_id = ? ORDER BY b.content_hash
      `).all(id),
    }
  }

  function enqueueOperation(input: Readonly<{
    shareId: number
    localRevisionId?: number | null
    idempotencyKey: string
    kind: 'publish' | 'unpublish' | 'delete' | 'resource-snapshot'
    availableAtMs?: number
  }>) {
    assertPositiveId(input.shareId, 'Share ID')
    if (input.localRevisionId != null) assertPositiveId(input.localRevisionId, 'Local share revision ID')
    const at = now()
    sqlite.query(`
      INSERT INTO share_publication_operations (
        share_id, local_revision_id, idempotency_key, kind, state,
        available_at_ms, created_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        local_revision_id = excluded.local_revision_id,
        state = 'queued', attempt_count = 0,
        available_at_ms = excluded.available_at_ms,
        remote_operation_id = NULL, last_error_code = NULL,
        updated_at_ms = excluded.updated_at_ms
      WHERE share_publication_operations.state = 'cancelled'
    `).run(input.shareId, input.localRevisionId ?? null, input.idempotencyKey, input.kind, input.availableAtMs ?? at, at, at)
    return sqlite.query(`
      SELECT id, share_id AS shareId, local_revision_id AS localRevisionId,
        idempotency_key AS idempotencyKey, kind, state, attempt_count AS attemptCount,
        available_at_ms AS availableAtMs, remote_operation_id AS remoteOperationId,
        last_error_code AS lastErrorCode, created_at_ms AS createdAtMs,
        updated_at_ms AS updatedAtMs
      FROM share_publication_operations WHERE idempotency_key = ?
    `).get(input.idempotencyKey)
  }

  function cancelPendingOperations(shareId: number, kind: 'publish' | 'unpublish' | 'delete' | 'resource-snapshot' = 'publish') {
    assertPositiveId(shareId, 'Share ID')
    return sqlite.query(`
      UPDATE share_publication_operations
      SET state = 'cancelled', updated_at_ms = ?
      WHERE share_id = ? AND kind = ? AND state IN ('queued', 'retrying')
    `).run(now(), shareId, kind).changes
  }

  function nextOperation(at = now()) {
    return sqlite.query(`
      SELECT id, share_id AS shareId, local_revision_id AS localRevisionId,
        idempotency_key AS idempotencyKey, kind, state, attempt_count AS attemptCount,
        available_at_ms AS availableAtMs, remote_operation_id AS remoteOperationId,
        last_error_code AS lastErrorCode, created_at_ms AS createdAtMs,
        updated_at_ms AS updatedAtMs
      FROM share_publication_operations
      WHERE state IN ('queued','retrying') AND available_at_ms <= ?
      ORDER BY available_at_ms, id LIMIT 1
    `).get(at)
  }

  function updateOperation(id: number, patch: Readonly<{
    state: 'running' | 'retrying' | 'succeeded' | 'failed' | 'cancelled'
    attemptCount?: number
    availableAtMs?: number
    remoteOperationId?: number | null
    lastErrorCode?: string | null
  }>) {
    assertPositiveId(id, 'Publication operation ID')
    const current = sqlite.query('SELECT attempt_count AS attemptCount, available_at_ms AS availableAtMs, remote_operation_id AS remoteOperationId, last_error_code AS lastErrorCode FROM share_publication_operations WHERE id = ?').get(id) as Record<string, number | string | null> | null
    if (!current) throw new Error(`Publication operation ${id} does not exist.`)
    sqlite.query(`
      UPDATE share_publication_operations
      SET state = ?, attempt_count = ?, available_at_ms = ?, remote_operation_id = ?,
          last_error_code = ?, updated_at_ms = ? WHERE id = ?
    `).run(
      patch.state, patch.attemptCount ?? current.attemptCount,
      patch.availableAtMs ?? current.availableAtMs,
      patch.remoteOperationId === undefined ? current.remoteOperationId : patch.remoteOperationId,
      patch.lastErrorCode === undefined ? current.lastErrorCode : patch.lastErrorCode,
      now(), id,
    )
  }

  function saveResourceSnapshot(shareId: number, contentHash: string, payload: unknown, capturedAtMs = now()) {
    assertPositiveId(shareId, 'Share ID')
    const payloadJson = JSON.stringify(payload)
    sqlite.query(`
      INSERT INTO share_resource_snapshots (share_id, content_hash, payload_json, captured_at_ms)
      VALUES (?, ?, ?, ?) ON CONFLICT(share_id, content_hash) DO NOTHING
    `).run(shareId, contentHash, payloadJson, capturedAtMs)
    return sqlite.query(`SELECT id, share_id AS shareId, content_hash AS contentHash, payload_json AS payloadJson, captured_at_ms AS capturedAtMs FROM share_resource_snapshots WHERE share_id = ? AND content_hash = ?`)
      .get(shareId, contentHash)
  }

  return {
    getSettings,
    setConnectionEnabled,
    updateEnrollment,
    getInstallationProjection,
    reconcileInstallationAccount,
    saveInstallationProjection,
    deleteInstallationProjection,
    getAccountOperation,
    prepareAccountUnlink,
    markAccountUnlinkRetryable,
    failAccountUnlink,
    completeAccountUnlink,
    createShare,
    getShare,
    getShareByRemotePublicId,
    applyRemoteEvent,
    listShares,
    getShareConfiguration,
    updateShareConfiguration,
    updateShare,
    persistRevision,
    getLocalRevision,
    enqueueOperation,
    cancelPendingOperations,
    nextOperation,
    updateOperation,
    saveResourceSnapshot,
  }
}

function remoteShareState(value: unknown): ShareState {
  if (value === 'active') return 'synced'
  if (value === 'unpublished' || value === 'deleted' || value === 'expired' || value === 'grace-period') return value
  throw new Error('Remote share event state is invalid.')
}

function normalizeAccountUnlinkResult(value: AccountUnlinkResult, operation: SharingAccountOperation): AccountUnlinkResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Sharing account unlink result is invalid.')
  const account = value.account
  const affected = value.affected
  if (
    !account || typeof account !== 'object' || Array.isArray(account)
    || account.connected !== false || account.githubUsername !== null
    || !Number.isSafeInteger(account.bindingRevision) || account.bindingRevision < 1
    || value.disposition !== operation.shareDisposition
    || !affected || typeof affected !== 'object' || Array.isArray(affected)
  ) throw new Error('Sharing account unlink result is invalid.')
  const counts = [affected.shares, affected.keptOnline, affected.unpublished, affected.deleted]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 0)) throw new Error('Sharing account unlink counts are invalid.')
  const expected = value.disposition === 'keep'
    ? [affected.shares, 0, 0]
    : value.disposition === 'unpublish'
      ? [0, affected.shares, 0]
      : [0, 0, affected.shares]
  if ([affected.keptOnline, affected.unpublished, affected.deleted].some((count, index) => count !== expected[index])) {
    throw new Error('Sharing account unlink counts do not match the disposition.')
  }
  return {
    account: { connected: false, githubUsername: null, bindingRevision: account.bindingRevision },
    disposition: value.disposition,
    affected: {
      shares: affected.shares,
      keptOnline: affected.keptOnline,
      unpublished: affected.unpublished,
      deleted: affected.deleted,
    },
  }
}

function booleans(row: Record<string, unknown>, names: readonly string[]) {
  const result = { ...row }
  for (const name of names) result[name] = Boolean(result[name])
  return result
}

function mapShare(row: Record<string, unknown>, accountClaimed: boolean): ShareRecord {
  const result = booleans(row, ['commentsEnabled', 'reactionsEnabled', 'embedEnabled', 'resourceSnapshotIncluded', 'accountClaimed'])
  result.accountClaimed = accountClaimed
  const origins = JSON.parse(String(result.embedOriginsJson ?? '[]'))
  if (!Array.isArray(origins) || origins.some((origin) => typeof origin !== 'string')) throw new Error('Stored share embed origins are invalid.')
  result.embedOrigins = origins
  delete result.embedOriginsJson
  return result as ShareRecord
}

function normalizedOrigins(origins: readonly string[]) {
  return [...new Set(origins.map((origin) => {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('Embed origins must be exact HTTPS origins.')
    }
    return parsed.origin
  }))].sort()
}

function uniqueIds(values: readonly number[], label: string) {
  const unique = new Set<number>()
  for (const value of values) unique.add(assertPositiveId(value, label))
  return [...unique].sort((left, right) => left - right)
}

export type SharingRepository = ReturnType<typeof createSharingRepository>
