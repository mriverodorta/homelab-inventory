import type { Database } from 'bun:sqlite'
import { createAuthenticationStore } from '../../../auth/model.mjs'

type Row = Record<string, any>

function parse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return structuredClone(fallback)
  return JSON.parse(value) as T
}

function iso(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value).toISOString()
    : undefined
}

function milliseconds(value: unknown, fallback: number | null = null) {
  if (typeof value !== 'string') return fallback
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function json(value: unknown) {
  return JSON.stringify(value ?? {})
}

function putMetadata(database: Database, key: string, value: unknown, now: number) {
  database.query(`
    INSERT INTO application_metadata (key, value_json, updated_at_ms)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms
  `).run(key, json(value), now)
}

function defined(record: Row) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => value !== undefined && value !== null))
}

function metadata(database: Database, key: string, fallback: Row) {
  const row = database.query('SELECT value_json FROM application_metadata WHERE key = ?').get(key) as { value_json: string } | null
  return parse(row?.value_json, fallback)
}

export function projectRegistryState(database: Database) {
  const settings = database.query('SELECT * FROM registry_settings WHERE id = 1').get() as Row | null
  const extended = metadata(database, 'legacy.registry-extended-state', {})
  return {
    settings: defined({
      mode: settings?.mode ?? 'disabled',
      defaultInventorySource: settings?.default_inventory_source ?? 'catalog',
      automaticContributions: Boolean(settings?.automatic_contributions),
      showRegistryLinkIndicators: Boolean(settings?.show_link_indicators),
      updatedAt: iso(settings?.updated_at_ms),
    }),
    sources: (database.query('SELECT * FROM registry_sources ORDER BY id').all() as Row[]).map((source) => defined({
      id: source.id,
      kind: source.kind,
      displayName: source.display_name,
      endpoint: source.endpoint,
      trustedKeyId: source.trusted_key_id,
      enabled: Boolean(source.enabled),
      lastCheckedAt: iso(source.last_checked_at_ms),
      lastSuccessAt: iso(source.last_success_at_ms),
      lastError: source.last_error,
      createdAt: iso(source.created_at_ms),
    })),
    links: (database.query(`
      SELECT l.*, a.legacy_type_key, a.legacy_id
      FROM registry_links l
      JOIN inventory_identity_aliases a ON a.item_id = l.item_id
      ORDER BY l.id
    `).all() as Row[]).map((link) => defined({
      id: link.id,
      itemType: link.legacy_type_key,
      itemId: link.legacy_id,
      sourceId: link.source_id,
      templateKey: link.template_key,
      importedRevision: link.imported_revision,
      importedContentHash: link.imported_content_hash,
      importedFingerprintVersion: link.imported_fingerprint_version,
      availableRevision: link.available_revision,
      state: link.state,
      linkedAt: iso(link.linked_at_ms),
      updatedAt: iso(link.updated_at_ms),
    })),
    variantMatches: extended.variantMatches ?? [],
    contributionOutbox: extended.contributionOutbox ?? [],
    contributionLedger: extended.contributionLedger ?? [],
    contributionGroups: extended.contributionGroups ?? [],
    projectionCache: extended.projectionCache ?? [],
    privateTemplates: extended.privateTemplates ?? [],
    snapshot: extended.snapshot ?? null,
    installationIdentity: extended.installationIdentity ?? null,
  }
}

export function persistRegistryState(
  database: Database,
  state: Row,
  now: number,
  resolveItem: (type: string, id: number) => number,
) {
  const settings = state.settings ?? {}
  database.query(`
    INSERT INTO registry_settings (
      id, mode, default_inventory_source, automatic_contributions,
      show_link_indicators, updated_at_ms
    ) VALUES (1, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      mode = excluded.mode,
      default_inventory_source = excluded.default_inventory_source,
      automatic_contributions = excluded.automatic_contributions,
      show_link_indicators = excluded.show_link_indicators,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    settings.mode ?? 'disabled',
    settings.defaultInventorySource ?? 'catalog',
    Number(settings.mode === 'connected' && settings.automaticContributions === true),
    Number(settings.showRegistryLinkIndicators === true),
    milliseconds(settings.updatedAt, now),
  )
  database.query('DELETE FROM registry_links').run()
  database.query('DELETE FROM registry_sources').run()
  const insertSource = database.query(`
    INSERT INTO registry_sources (
      id, kind, display_name, endpoint, trusted_key_id, enabled,
      last_checked_at_ms, last_success_at_ms, last_error, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const source of state.sources ?? []) {
    insertSource.run(
      source.id,
      source.kind,
      source.displayName,
      source.endpoint ?? null,
      source.trustedKeyId ?? null,
      Number(source.enabled !== false),
      milliseconds(source.lastCheckedAt),
      milliseconds(source.lastSuccessAt),
      source.lastError ?? null,
      milliseconds(source.createdAt, now),
    )
  }
  const insertLink = database.query(`
    INSERT INTO registry_links (
      id, item_id, source_id, template_key, imported_revision,
      imported_content_hash, imported_fingerprint_version, available_revision,
      state, linked_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const link of state.links ?? []) {
    insertLink.run(
      link.id,
      resolveItem(link.itemType, link.itemId),
      link.sourceId,
      link.templateKey,
      link.importedRevision,
      link.importedContentHash,
      link.importedFingerprintVersion ?? 1,
      link.availableRevision ?? null,
      link.state,
      milliseconds(link.linkedAt, now),
      milliseconds(link.updatedAt, now),
    )
  }
  putMetadata(database, 'legacy.registry-extended-state', {
    variantMatches: state.variantMatches ?? [],
    contributionOutbox: state.contributionOutbox ?? [],
    contributionLedger: state.contributionLedger ?? [],
    contributionGroups: state.contributionGroups ?? [],
    projectionCache: state.projectionCache ?? [],
    privateTemplates: state.privateTemplates ?? [],
    snapshot: state.snapshot ?? null,
    installationIdentity: state.installationIdentity ?? null,
  }, now)
}

export function projectAuthenticationState(database: Database) {
  const settings = database.query('SELECT * FROM authentication_settings WHERE id = 1').get() as Row | null
  const extended = metadata(database, 'legacy.authentication-extended-state', {})
  const defaults = createAuthenticationStore({ setupRequired: Boolean(settings?.setup_required) })
  const accounts = (database.query('SELECT * FROM users ORDER BY id').all() as Row[]).map((account) => defined({
    id: account.id,
    username: account.username,
    email: account.email,
    displayName: account.display_name,
    protectedOwner: Boolean(account.protected_owner),
    active: Boolean(account.active),
    createdAt: iso(account.created_at_ms),
    updatedAt: iso(account.updated_at_ms),
  }))
  const roles = Array.isArray(extended.roles) && extended.roles.length ? extended.roles : defaults.roles
  const rolePermissions = Array.isArray(extended.rolePermissions) && extended.rolePermissions.length
    ? extended.rolePermissions
    : defaults.rolePermissions
  const accountRoles = Array.isArray(extended.accountRoles) ? structuredClone(extended.accountRoles) : []
  const protectedOwner = accounts.find((account) => account.protectedOwner)
  const ownerRole = roles.find((role: Row) => role.key === 'owner')
  if (protectedOwner && ownerRole && !accountRoles.some((assignment: Row) => assignment.accountId === protectedOwner.id && assignment.roleId === ownerRole.id)) {
    accountRoles.push({
      id: Math.max(0, ...accountRoles.map((assignment: Row) => assignment.id)) + 1,
      accountId: protectedOwner.id,
      roleId: ownerRole.id,
      scopeKind: 'global',
      scopeId: 0,
    })
  }
  return {
    ...extended,
    version: extended.version ?? defaults.version,
    nextAccountId: extended.nextAccountId ?? Math.max(0, ...accounts.map((account) => account.id)) + 1,
    roles,
    rolePermissions,
    accountRoles,
    nextRoleId: Array.isArray(extended.roles) && extended.roles.length ? extended.nextRoleId : defaults.nextRoleId,
    nextRolePermissionId: Array.isArray(extended.rolePermissions) && extended.rolePermissions.length
      ? extended.nextRolePermissionId
      : defaults.nextRolePermissionId,
    nextAccountRoleId: Math.max(
      extended.nextAccountRoleId ?? 1,
      Math.max(0, ...accountRoles.map((assignment: Row) => assignment.id)) + 1,
    ),
    configuration: {
      enabled: Boolean(settings?.enabled),
      localEnabled: Boolean(settings?.local_enabled),
      oidcEnabled: Boolean(settings?.oidc_enabled),
      oidc: defined({
        issuer: settings?.oidc_issuer,
        clientId: settings?.oidc_client_id,
        scopes: parse(settings?.oidc_scopes_json, ['openid', 'profile', 'email']),
        externalUrl: settings?.oidc_external_url,
        clientSecretConfigured: Boolean(settings?.oidc_client_secret_configured),
      }),
      updatedAt: iso(settings?.updated_at_ms) ?? null,
    },
    bootstrapState: {
      setupRequired: Boolean(settings?.setup_required),
      completedAt: iso(settings?.setup_completed_at_ms) ?? null,
    },
    accounts,
  }
}

export function persistAuthenticationState(database: Database, state: Row, now: number) {
  const settings = state.configuration ?? state.settings ?? {}
  const oidc = settings.oidc ?? settings
  const bootstrap = state.bootstrapState ?? settings
  database.query(`
    INSERT INTO authentication_settings (
      id, enabled, local_enabled, oidc_enabled, oidc_issuer, oidc_client_id,
      oidc_scopes_json, oidc_external_url, oidc_client_secret_configured,
      setup_required, setup_completed_at_ms, updated_at_ms
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      local_enabled = excluded.local_enabled,
      oidc_enabled = excluded.oidc_enabled,
      oidc_issuer = excluded.oidc_issuer,
      oidc_client_id = excluded.oidc_client_id,
      oidc_scopes_json = excluded.oidc_scopes_json,
      oidc_external_url = excluded.oidc_external_url,
      oidc_client_secret_configured = excluded.oidc_client_secret_configured,
      setup_required = excluded.setup_required,
      setup_completed_at_ms = excluded.setup_completed_at_ms,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    Number(settings.enabled === true),
    Number(settings.localEnabled === true),
    Number(settings.oidcEnabled === true),
    oidc.issuer ?? settings.oidcIssuer ?? null,
    oidc.clientId ?? settings.oidcClientId ?? null,
    json(oidc.scopes ?? settings.oidcScopes ?? ['openid', 'profile', 'email']),
    oidc.externalUrl ?? settings.oidcExternalUrl ?? null,
    Number((oidc.clientSecretConfigured ?? settings.oidcClientSecretConfigured) === true),
    Number((bootstrap.setupRequired ?? bootstrap.required) === true),
    milliseconds(bootstrap.completedAt ?? settings.setupCompletedAt),
    milliseconds(settings.updatedAt, now),
  )
  const insertAccount = database.query(`
    INSERT INTO users (
      id, username, email, display_name, protected_owner, active,
      created_at_ms, updated_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      username = excluded.username,
      email = excluded.email,
      display_name = excluded.display_name,
      protected_owner = excluded.protected_owner,
      active = excluded.active,
      updated_at_ms = excluded.updated_at_ms
  `)
  for (const account of state.accounts ?? []) {
    insertAccount.run(
      account.id,
      account.username,
      account.email ?? null,
      account.displayName ?? account.username,
      Number(account.protectedOwner === true),
      Number(account.active !== false),
      milliseconds(account.createdAt, now),
      milliseconds(account.updatedAt, now),
    )
  }
  const retainedAccountIds = new Set((state.accounts ?? []).map((account: Row) => account.id))
  for (const account of database.query('SELECT id, protected_owner FROM users').all() as Row[]) {
    if (retainedAccountIds.has(account.id)) continue
    if (account.protected_owner) throw new Error('The protected owner cannot be deleted.')
    database.query('DELETE FROM users WHERE id = ?').run(account.id)
  }
  const { settings: _settings, configuration: _configuration, bootstrapState: _bootstrapState, accounts: _accounts, ...extended } = state
  putMetadata(database, 'legacy.authentication-extended-state', extended, now)
}

export function projectBackupManagementState(database: Database) {
  const schedule = database.query('SELECT * FROM backup_schedules WHERE id = 1').get() as Row | null
  const extended = metadata(database, 'legacy.backup-extended-state', {})
  const relationalBackups = (database.query('SELECT * FROM backup_runs ORDER BY id').all() as Row[]).map((backup) => defined({
    id: backup.id,
    kind: backup.kind,
    label: backup.label,
    fileName: String(backup.path ?? `legacy-backup-${backup.id}.hlibackup`).split(/[\\/]/u).pop(),
    status: backup.state,
    sections: parse(backup.selected_sections_json, []),
    encrypted: false,
    sizeBytes: backup.size_bytes,
    appVersion: 'legacy',
    schemaVersion: 29,
    createdAt: iso(backup.started_at_ms) ?? null,
    verifiedAt: iso(backup.completed_at_ms) ?? null,
    error: backup.error_code ?? null,
  }))
  const backups = Array.isArray(extended.backups) && extended.backups.length
    ? extended.backups.map((backup: Row) => (
        backup.fileName
          ? backup
          : {
              id: backup.id,
              label: backup.label,
              fileName: String(backup.path ?? `legacy-backup-${backup.id}.hlibackup`).split(/[\\/]/u).pop(),
              kind: backup.kind,
              status: backup.status ?? backup.state,
              sections: backup.sections ?? backup.selectedSections ?? [],
              encrypted: backup.encrypted === true,
              sizeBytes: backup.sizeBytes ?? 0,
              appVersion: backup.appVersion ?? 'legacy',
              schemaVersion: backup.schemaVersion ?? 29,
              createdAt: backup.createdAt ?? backup.startedAt ?? null,
              verifiedAt: backup.verifiedAt ?? backup.completedAt ?? null,
              error: backup.error ?? backup.errorCode ?? null,
            }
      ))
    : relationalBackups
  const restores = extended.restores ?? []
  return {
    ...extended,
    nextBackupId: extended.nextBackupId ?? Math.max(0, ...backups.map((backup) => backup.id)) + 1,
    nextRestoreId: extended.nextRestoreId ?? Math.max(0, ...restores.map((restore: Row) => restore.id)) + 1,
    schedule: defined({
      enabled: Boolean(schedule?.enabled),
      frequency: schedule?.frequency ?? 'daily',
      time: schedule?.local_time ?? '02:00',
      weekday: schedule?.weekday ?? 0,
      timezone: schedule?.timezone,
      retention: schedule?.retention_count ?? 7,
      nextRunAt: iso(schedule?.next_run_at_ms) ?? null,
      lastRunAt: iso(schedule?.last_run_at_ms) ?? null,
      lastResult: schedule?.last_result ?? null,
      updatedAt: iso(schedule?.updated_at_ms) ?? null,
    }),
    backups,
    restores,
    operation: extended.operation ?? null,
  }
}

export function projectAgentState(database: Database) {
  const extended = metadata(database, 'legacy.agent-extended-state', {})
  const devices = Object.fromEntries((database.query(`
    SELECT a.*, identity.legacy_id, binding.state, binding.bound_at_ms,
           binding.unbound_at_ms, item_alias.legacy_type_key,
           item_alias.legacy_id AS legacy_host_id
    FROM agents a
    JOIN agent_identity_aliases identity ON identity.agent_id = a.id
    JOIN agent_host_bindings binding ON binding.agent_id = a.id
    JOIN inventory_identity_aliases item_alias ON item_alias.item_id = binding.host_item_id
    ORDER BY identity.legacy_id
  `).all() as Row[]).map((device) => {
    const legacyId = device.legacy_id
    return [String(legacyId), defined({
      ...(extended.deviceExtensions?.[String(legacyId)] ?? {}),
      id: legacyId,
      hostType: device.legacy_type_key,
      hostId: device.legacy_host_id,
      publicKey: device.public_key,
      protocolMajor: device.protocol_major,
      agentVersion: device.agent_version,
      version: device.agent_version,
      capabilities: parse(device.capabilities_json, {}),
      lastSequence: device.last_sequence,
      lastSeenAt: iso(device.last_seen_at_ms) ?? null,
      revokedAt: iso(device.revoked_at_ms),
      state: device.state,
      boundAt: iso(device.bound_at_ms),
      unboundAt: iso(device.unbound_at_ms),
      createdAt: iso(device.created_at_ms),
    })]
  }))
  return {
    enrollments: extended.enrollments ?? {},
    devices,
    hardwareSnapshots: extended.hardwareSnapshots ?? {},
    hardwareEvents: extended.hardwareEvents ?? {},
  }
}

export function projectAgentStatusState(database: Database) {
  const extended = metadata(database, 'legacy.agent-extended-state', {})
  return structuredClone(extended.status ?? { hosts: {} })
}

export function persistAgentExtendedState(
  database: Database,
  state: Row,
  status: Row,
  now: number,
) {
  putMetadata(database, 'legacy.agent-extended-state', {
    enrollments: state.enrollments ?? {},
    deviceExtensions: state.deviceExtensions ?? Object.fromEntries(
      Object.entries(state.devices ?? {}).map(([id, device]) => [id, device]),
    ),
    hardwareSnapshots: state.hardwareSnapshots ?? {},
    hardwareEvents: state.hardwareEvents ?? {},
    status,
  }, now)
}

export function persistBackupManagementState(database: Database, state: Row, now: number) {
  const schedule = state.schedule ?? {}
  database.query(`
    INSERT INTO backup_schedules (
      id, enabled, frequency, local_time, weekday, timezone, retention_count,
      next_run_at_ms, last_run_at_ms, last_result, updated_at_ms
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      enabled = excluded.enabled,
      frequency = excluded.frequency,
      local_time = excluded.local_time,
      weekday = excluded.weekday,
      timezone = excluded.timezone,
      retention_count = excluded.retention_count,
      next_run_at_ms = excluded.next_run_at_ms,
      last_run_at_ms = excluded.last_run_at_ms,
      last_result = excluded.last_result,
      updated_at_ms = excluded.updated_at_ms
  `).run(
    Number(schedule.enabled === true),
    schedule.frequency ?? 'daily',
    schedule.time ?? schedule.localTime ?? '02:00',
    schedule.weekday ?? 0,
    schedule.timezone ?? null,
    schedule.retention ?? schedule.retentionCount ?? 7,
    milliseconds(schedule.nextRunAt),
    milliseconds(schedule.lastRunAt),
    schedule.lastResult ?? null,
    milliseconds(schedule.updatedAt, now),
  )
  database.query('DELETE FROM backup_runs').run()
  const insertBackup = database.query(`
    INSERT INTO backup_runs (
      id, kind, label, state, format_version, selected_sections_json, path,
      size_bytes, digest, error_code, started_at_ms, completed_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const backup of state.backups ?? []) {
    insertBackup.run(
      backup.id,
      backup.kind,
      backup.label,
      backup.status ?? backup.state,
      backup.formatVersion ?? 1,
      json(backup.sections ?? backup.selectedSections ?? []),
      backup.fileName ?? backup.path ?? null,
      backup.sizeBytes ?? null,
      backup.digest ?? null,
      backup.error ?? backup.errorCode ?? null,
      milliseconds(backup.createdAt ?? backup.startedAt, now),
      milliseconds(backup.verifiedAt ?? backup.completedAt),
    )
  }
  putMetadata(database, 'legacy.backup-extended-state', {
    nextBackupId: state.nextBackupId,
    nextRestoreId: state.nextRestoreId,
    backups: state.backups ?? [],
    restores: state.restores ?? [],
    operation: state.operation ?? null,
  }, now)
}
