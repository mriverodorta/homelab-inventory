import type { Database } from 'bun:sqlite'
import { createAuthenticationStore } from '../../../auth/model.mjs'
import { PERMISSIONS } from '../../../auth/permission-catalog.mjs'

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
      availableContentHash: link.available_content_hash,
      productFamily: parse(link.product_family_json, null),
      variantEvidence: parse(link.variant_evidence_json, null),
      identityAliases: parse(link.identity_aliases_json, null),
      state: link.state,
      linkedAt: iso(link.linked_at_ms),
      updatedAt: iso(link.updated_at_ms),
      detachedAt: iso(link.detached_at_ms),
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
      available_content_hash, product_family_json, variant_evidence_json,
      identity_aliases_json, state, linked_at_ms, updated_at_ms, detached_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      link.availableContentHash ?? null,
      link.productFamily ? JSON.stringify(link.productFamily) : null,
      link.variantEvidence ? JSON.stringify(link.variantEvidence) : null,
      link.identityAliases ? JSON.stringify(link.identityAliases) : null,
      link.state,
      milliseconds(link.linkedAt, now),
      milliseconds(link.updatedAt, now),
      milliseconds(link.detachedAt),
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
  const { recordExtensions: _recordExtensions, ...publicExtended } = extended
  const defaults = createAuthenticationStore({ setupRequired: Boolean(settings?.setup_required) })
  const builtInTimestamp = iso(settings?.updated_at_ms) ?? '1970-01-01T00:00:00.000Z'
  defaults.roles = defaults.roles.map((role: Row) => ({
    ...role,
    createdAt: builtInTimestamp,
    updatedAt: builtInTimestamp,
  }))
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
  const extensionFor = (group: string, id: number) => extended.recordExtensions?.[group]?.[String(id)] ?? {}
  const localCredentials = (database.query('SELECT * FROM credentials ORDER BY id').all() as Row[]).map((credential) => defined({
    ...extensionFor('localCredentials', credential.id),
    id: credential.id,
    accountId: credential.user_id,
    passwordHash: credential.secret_hash,
    createdAt: iso(credential.created_at_ms),
    updatedAt: iso(credential.updated_at_ms),
  }))
  const oidcIdentities = (database.query('SELECT * FROM user_identities ORDER BY id').all() as Row[]).map((identity) => defined({
    ...extensionFor('oidcIdentities', identity.id),
    id: identity.id,
    accountId: identity.user_id,
    issuer: identity.issuer,
    subject: identity.subject,
    email: identity.email,
    createdAt: iso(identity.created_at_ms),
    lastLoginAt: iso(identity.last_login_at_ms),
  }))
  const sessions = (database.query('SELECT * FROM sessions ORDER BY id').all() as Row[]).map((session) => defined({
    ...extensionFor('sessions', session.id),
    id: session.id,
    accountId: session.user_id,
    tokenHash: session.token_hash,
    remember: Boolean(session.remember),
    createdAt: iso(session.created_at_ms),
    lastSeenAt: iso(session.last_seen_at_ms),
    idleExpiresAt: iso(session.idle_expires_at_ms),
    absoluteExpiresAt: iso(session.absolute_expires_at_ms),
    revokedAt: iso(session.revoked_at_ms) ?? null,
    userAgent: session.user_agent_hash,
    ip: session.ip_hash,
  }))
  const recoveryTokens = (database.query('SELECT * FROM recovery_tokens ORDER BY id').all() as Row[]).map((token) => defined({
    ...extensionFor('recoveryTokens', token.id), id: token.id, accountId: token.user_id,
    tokenHash: token.token_hash, createdAt: iso(token.created_at_ms), expiresAt: iso(token.expires_at_ms),
    usedAt: iso(token.used_at_ms) ?? null,
  }))
  const securityEvents = (database.query('SELECT * FROM security_events ORDER BY id').all() as Row[]).map((event) => {
    const details = parse(event.details_json, {}) as Row
    return defined({
      ...extensionFor('securityEvents', event.id), ...details, id: event.id,
      accountId: event.actor_user_id ?? event.user_id, type: event.type,
      detail: details.detail ?? event.target, createdAt: iso(event.created_at_ms),
    })
  })
  const oidcTransactions = (database.query('SELECT * FROM oidc_transactions ORDER BY id').all() as Row[]).map((transaction) => defined({
    ...extensionFor('oidcTransactions', transaction.id), id: transaction.id,
    accountId: transaction.user_id, invitationId: transaction.invitation_id,
    tokenHash: transaction.token_hash, state: transaction.state, nonce: transaction.nonce,
    codeVerifier: transaction.code_verifier, returnTo: transaction.return_to,
    createdAt: iso(transaction.created_at_ms), expiresAt: iso(transaction.expires_at_ms),
    usedAt: iso(transaction.used_at_ms) ?? null,
  }))
  const relationalRoles = (database.query('SELECT * FROM roles ORDER BY id').all() as Row[]).map((role) => defined({
    ...extensionFor('roles', role.id), id: role.id, key: role.key, name: role.name,
    description: role.description, builtIn: Boolean(role.built_in), active: Boolean(role.active),
    createdAt: iso(role.created_at_ms), updatedAt: iso(role.updated_at_ms),
  }))
  const roles = relationalRoles.length ? relationalRoles : defaults.roles
  const relationalRolePermissions = (database.query('SELECT * FROM role_permissions ORDER BY id').all() as Row[]).map((relation) => ({
    id: relation.id, roleId: relation.role_id, permissionId: relation.permission_id,
  }))
  const rolePermissions = relationalRolePermissions.length ? relationalRolePermissions : defaults.rolePermissions
  const accountRoles = (database.query('SELECT * FROM user_roles ORDER BY id').all() as Row[]).map((assignment) => ({
    id: assignment.id, accountId: assignment.user_id, roleId: assignment.role_id,
    scopeKind: assignment.scope_kind, scopeId: assignment.scope_id,
  }))
  const invitations = (database.query('SELECT * FROM invitations ORDER BY id').all() as Row[]).map((invitation) => defined({
    ...extensionFor('invitations', invitation.id), id: invitation.id, email: invitation.email,
    identityType: invitation.identity_type, status: invitation.status, tokenHash: invitation.token_hash,
    createdByAccountId: invitation.created_by_user_id, accountId: invitation.accepted_user_id,
    roleIds: (database.query('SELECT role_id FROM invitation_roles WHERE invitation_id = ? ORDER BY role_id').all(invitation.id) as Row[]).map((row) => row.role_id),
    createdAt: iso(invitation.created_at_ms), expiresAt: iso(invitation.expires_at_ms),
    acceptedAt: iso(invitation.accepted_at_ms) ?? null, revokedAt: iso(invitation.revoked_at_ms) ?? null,
  }))
  const identityLinkRequests = (database.query('SELECT * FROM identity_link_requests ORDER BY id').all() as Row[]).map((request) => defined({
    ...extensionFor('identityLinkRequests', request.id), ...parse(request.details_json, {}), id: request.id,
    accountId: request.user_id, identityType: request.identity_type, status: request.status,
    tokenHash: request.token_hash, createdAt: iso(request.created_at_ms), expiresAt: iso(request.expires_at_ms),
    confirmedAt: iso(request.confirmed_at_ms) ?? null,
  }))
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
    ...publicExtended,
    version: extended.version ?? defaults.version,
    nextAccountId: extended.nextAccountId ?? Math.max(0, ...accounts.map((account) => account.id)) + 1,
    nextLocalCredentialId: extended.nextLocalCredentialId ?? Math.max(0, ...localCredentials.map((record) => record.id)) + 1,
    nextOidcIdentityId: extended.nextOidcIdentityId ?? Math.max(0, ...oidcIdentities.map((record) => record.id)) + 1,
    nextSessionId: extended.nextSessionId ?? Math.max(0, ...sessions.map((record) => record.id)) + 1,
    nextRecoveryTokenId: extended.nextRecoveryTokenId ?? Math.max(0, ...recoveryTokens.map((record) => record.id)) + 1,
    nextSecurityEventId: extended.nextSecurityEventId ?? Math.max(0, ...securityEvents.map((record) => record.id)) + 1,
    nextOidcTransactionId: extended.nextOidcTransactionId ?? Math.max(0, ...oidcTransactions.map((record) => record.id)) + 1,
    roles,
    rolePermissions,
    accountRoles,
    nextRoleId: extended.nextRoleId ?? Math.max(0, ...roles.map((role: Row) => role.id)) + 1,
    nextRolePermissionId: extended.nextRolePermissionId ?? Math.max(0, ...rolePermissions.map((record: Row) => record.id)) + 1,
    nextAccountRoleId: Math.max(
      extended.nextAccountRoleId ?? 1,
      Math.max(0, ...accountRoles.map((assignment: Row) => assignment.id)) + 1,
    ),
    nextInvitationId: extended.nextInvitationId ?? Math.max(0, ...invitations.map((record) => record.id)) + 1,
    nextIdentityLinkRequestId: extended.nextIdentityLinkRequestId ?? Math.max(0, ...identityLinkRequests.map((record) => record.id)) + 1,
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
    localCredentials,
    oidcIdentities,
    sessions,
    recoveryTokens,
    securityEvents,
    oidcTransactions,
    invitations,
    identityLinkRequests,
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
  for (const table of [
    'invitation_roles', 'user_roles', 'role_permissions', 'identity_link_requests',
    'oidc_transactions', 'security_events', 'recovery_tokens', 'sessions',
    'user_identities', 'credentials', 'invitations', 'roles', 'permissions',
  ]) database.query(`DELETE FROM ${table}`).run()

  const insertAccount = database.query(`INSERT INTO users (
    id, username, email, display_name, protected_owner, active, created_at_ms, updated_at_ms
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    username = excluded.username,
    email = excluded.email,
    display_name = excluded.display_name,
    protected_owner = excluded.protected_owner,
    active = excluded.active,
    updated_at_ms = excluded.updated_at_ms`)
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
  const insertPermission = database.query('INSERT INTO permissions (id, permission_key, category, description, risk) VALUES (?, ?, ?, ?, ?)')
  for (const permission of PERMISSIONS) insertPermission.run(
    permission.id,
    permission.key,
    permission.group,
    permission.description,
    permission.risk === 'destructive' ? 'elevated' : permission.risk,
  )

  const insertRole = database.query('INSERT INTO roles (id, key, name, description, built_in, active, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const role of state.roles ?? []) insertRole.run(role.id, role.key, role.name, role.description ?? '', Number(role.builtIn === true), Number(role.active !== false), milliseconds(role.createdAt, now), milliseconds(role.updatedAt, now))

  const insertCredential = database.query("INSERT INTO credentials (id, user_id, type, secret_hash, algorithm, created_at_ms, updated_at_ms) VALUES (?, ?, 'password', ?, ?, ?, ?)")
  for (const credential of state.localCredentials ?? []) insertCredential.run(credential.id, credential.accountId, credential.passwordHash, String(credential.passwordHash ?? '').startsWith('$argon2') ? 'argon2id' : 'legacy', milliseconds(credential.createdAt, now), milliseconds(credential.updatedAt, now))

  const insertIdentity = database.query("INSERT INTO user_identities (id, user_id, provider, issuer, subject, email, created_at_ms, last_login_at_ms) VALUES (?, ?, 'oidc', ?, ?, ?, ?, ?)")
  for (const identity of state.oidcIdentities ?? []) insertIdentity.run(identity.id, identity.accountId, identity.issuer, identity.subject, identity.email ?? null, milliseconds(identity.createdAt, now), milliseconds(identity.lastLoginAt))

  const insertSession = database.query('INSERT INTO sessions (id, user_id, token_hash, remember, created_at_ms, last_seen_at_ms, idle_expires_at_ms, absolute_expires_at_ms, revoked_at_ms, user_agent_hash, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const session of state.sessions ?? []) insertSession.run(session.id, session.accountId, session.tokenHash, Number(session.remember === true), milliseconds(session.createdAt, now), milliseconds(session.lastSeenAt, now), milliseconds(session.idleExpiresAt, now), milliseconds(session.absoluteExpiresAt, now), milliseconds(session.revokedAt), session.userAgent ?? null, session.ip ?? null)

  const insertRecovery = database.query('INSERT INTO recovery_tokens (id, user_id, token_hash, created_at_ms, expires_at_ms, used_at_ms) VALUES (?, ?, ?, ?, ?, ?)')
  for (const token of state.recoveryTokens ?? []) insertRecovery.run(token.id, token.accountId ?? null, token.tokenHash, milliseconds(token.createdAt, now), milliseconds(token.expiresAt, now), milliseconds(token.usedAt))

  const insertEvent = database.query('INSERT INTO security_events (id, user_id, actor_user_id, type, target, details_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
  for (const event of state.securityEvents ?? []) insertEvent.run(event.id, event.subjectAccountId ?? null, event.accountId ?? null, event.type, event.detail ?? null, json(defined({ detail: event.detail, ip: event.ip, userAgent: event.userAgent })), milliseconds(event.createdAt, now))

  const insertTransaction = database.query('INSERT INTO oidc_transactions (id, user_id, token_hash, state, nonce, code_verifier, return_to, invitation_id, created_at_ms, expires_at_ms, used_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const transaction of state.oidcTransactions ?? []) insertTransaction.run(transaction.id, transaction.accountId ?? null, transaction.tokenHash, transaction.state, transaction.nonce, transaction.codeVerifier, transaction.returnTo, transaction.invitationId ?? null, milliseconds(transaction.createdAt, now), milliseconds(transaction.expiresAt, now), milliseconds(transaction.usedAt))

  const insertRolePermission = database.query('INSERT INTO role_permissions (id, role_id, permission_id) VALUES (?, ?, ?)')
  for (const relation of state.rolePermissions ?? []) insertRolePermission.run(relation.id, relation.roleId, relation.permissionId)
  const insertAccountRole = database.query('INSERT INTO user_roles (id, user_id, role_id, scope_kind, scope_id) VALUES (?, ?, ?, ?, ?)')
  for (const assignment of state.accountRoles ?? []) insertAccountRole.run(assignment.id, assignment.accountId, assignment.roleId, assignment.scopeKind, assignment.scopeId)

  const insertInvitation = database.query('INSERT INTO invitations (id, email, identity_type, status, token_hash, created_by_user_id, accepted_user_id, created_at_ms, expires_at_ms, accepted_at_ms, revoked_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
  const insertInvitationRole = database.query('INSERT INTO invitation_roles (id, invitation_id, role_id) VALUES (?, ?, ?)')
  let invitationRoleId = 1
  for (const invitation of state.invitations ?? []) {
    insertInvitation.run(invitation.id, invitation.email, invitation.identityType, invitation.status, invitation.tokenHash, invitation.createdByAccountId, invitation.accountId ?? null, milliseconds(invitation.createdAt, now), milliseconds(invitation.expiresAt, now), milliseconds(invitation.acceptedAt), milliseconds(invitation.revokedAt))
    for (const roleId of invitation.roleIds ?? []) insertInvitationRole.run(invitationRoleId++, invitation.id, roleId)
  }

  const insertLinkRequest = database.query('INSERT INTO identity_link_requests (id, user_id, identity_type, status, token_hash, details_json, created_at_ms, expires_at_ms, confirmed_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
  for (const request of state.identityLinkRequests ?? []) insertLinkRequest.run(request.id, request.accountId, request.identityType, request.status, request.tokenHash, json(defined({ email: request.email, issuer: request.issuer, subject: request.subject })), milliseconds(request.createdAt, now), milliseconds(request.expiresAt, now), milliseconds(request.confirmedAt))

  const entityKeys = new Set([
    'settings', 'configuration', 'bootstrapState', 'accounts', 'localCredentials', 'oidcIdentities',
    'sessions', 'recoveryTokens', 'securityEvents', 'oidcTransactions', 'roles', 'rolePermissions',
    'accountRoles', 'invitations', 'identityLinkRequests',
  ])
  const extended = Object.fromEntries(Object.entries(state).filter(([key]) => !entityKeys.has(key)))
  const knownByGroup: Record<string, Set<string>> = {
    localCredentials: new Set(['id', 'accountId', 'passwordHash', 'createdAt', 'updatedAt']),
    oidcIdentities: new Set(['id', 'accountId', 'issuer', 'subject', 'email', 'createdAt', 'lastLoginAt']),
    sessions: new Set(['id', 'accountId', 'tokenHash', 'remember', 'createdAt', 'lastSeenAt', 'idleExpiresAt', 'absoluteExpiresAt', 'revokedAt', 'userAgent', 'ip']),
    recoveryTokens: new Set(['id', 'accountId', 'tokenHash', 'createdAt', 'expiresAt', 'usedAt']),
    securityEvents: new Set(['id', 'accountId', 'subjectAccountId', 'type', 'detail', 'ip', 'userAgent', 'createdAt']),
    oidcTransactions: new Set(['id', 'accountId', 'invitationId', 'tokenHash', 'state', 'nonce', 'codeVerifier', 'returnTo', 'createdAt', 'expiresAt', 'usedAt']),
    roles: new Set(['id', 'key', 'name', 'description', 'builtIn', 'active', 'createdAt', 'updatedAt']),
    invitations: new Set(['id', 'email', 'identityType', 'status', 'tokenHash', 'createdByAccountId', 'accountId', 'roleIds', 'createdAt', 'expiresAt', 'acceptedAt', 'revokedAt']),
    identityLinkRequests: new Set(['id', 'accountId', 'identityType', 'status', 'tokenHash', 'email', 'issuer', 'subject', 'createdAt', 'expiresAt', 'confirmedAt']),
  }
  const recordExtensions: Row = {}
  for (const [group, known] of Object.entries(knownByGroup)) {
    for (const record of state[group] ?? []) {
      const unknown = Object.fromEntries(Object.entries(record).filter(([key]) => !known.has(key)))
      if (Object.keys(unknown).length) (recordExtensions[group] ??= {})[String(record.id)] = unknown
    }
  }
  if (Object.keys(recordExtensions).length) extended.recordExtensions = recordExtensions
  else delete extended.recordExtensions
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
