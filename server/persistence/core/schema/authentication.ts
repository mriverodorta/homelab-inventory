import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const authenticationSettings = sqliteTable('authentication_settings', {
  id: integer('id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  localEnabled: integer('local_enabled', { mode: 'boolean' }).notNull().default(false),
  oidcEnabled: integer('oidc_enabled', { mode: 'boolean' }).notNull().default(false),
  oidcIssuer: text('oidc_issuer'),
  oidcClientId: text('oidc_client_id'),
  oidcScopesJson: text('oidc_scopes_json').notNull().default('["openid","profile","email"]'),
  oidcExternalUrl: text('oidc_external_url'),
  oidcClientSecretConfigured: integer('oidc_client_secret_configured', { mode: 'boolean' }).notNull().default(false),
  setupRequired: integer('setup_required', { mode: 'boolean' }).notNull().default(false),
  setupCompletedAtMs: integer('setup_completed_at_ms'),
  updatedAtMs: integer('updated_at_ms'),
}, (table) => [
  check('authentication_settings_singleton_check', sql`${table.id} = 1`),
  check('authentication_settings_method_check', sql`${table.enabled} = 0 OR ${table.localEnabled} = 1 OR ${table.oidcEnabled} = 1`),
  check('authentication_settings_scopes_json_check', sql`json_valid(${table.oidcScopesJson})`),
])

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull(),
  email: text('email'),
  displayName: text('display_name').notNull(),
  protectedOwner: integer('protected_owner', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('users_username_unique').on(table.username),
  uniqueIndex('users_email_unique').on(table.email).where(sql`${table.email} IS NOT NULL`),
  uniqueIndex('users_protected_owner_unique').on(table.protectedOwner).where(sql`${table.protectedOwner} = 1`),
])

export const credentials = sqliteTable('credentials', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  secretHash: text('secret_hash').notNull(),
  algorithm: text('algorithm').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [
  uniqueIndex('credentials_user_type_unique').on(table.userId, table.type),
  check('credentials_type_check', sql`${table.type} IN ('password')`),
])

export const userIdentities = sqliteTable('user_identities', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  issuer: text('issuer').notNull(),
  subject: text('subject').notNull(),
  email: text('email'),
  createdAtMs: integer('created_at_ms').notNull(),
  lastLoginAtMs: integer('last_login_at_ms'),
}, (table) => [
  uniqueIndex('user_identities_provider_subject_unique').on(table.provider, table.issuer, table.subject),
  index('user_identities_user_index').on(table.userId),
  check('user_identities_provider_check', sql`${table.provider} IN ('oidc')`),
])

export const sessions = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  remember: integer('remember', { mode: 'boolean' }).notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  lastSeenAtMs: integer('last_seen_at_ms').notNull(),
  idleExpiresAtMs: integer('idle_expires_at_ms').notNull(),
  absoluteExpiresAtMs: integer('absolute_expires_at_ms').notNull(),
  revokedAtMs: integer('revoked_at_ms'),
  userAgentHash: text('user_agent_hash'),
  ipHash: text('ip_hash'),
}, (table) => [
  uniqueIndex('sessions_token_hash_unique').on(table.tokenHash),
  index('sessions_user_index').on(table.userId, table.revokedAtMs),
  check('sessions_token_hash_check', sql`length(${table.tokenHash}) = 64`),
  check('sessions_expiry_check', sql`${table.createdAtMs} <= ${table.idleExpiresAtMs} AND ${table.idleExpiresAtMs} <= ${table.absoluteExpiresAtMs}`),
])

export const recoveryTokens = sqliteTable('recovery_tokens', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  usedAtMs: integer('used_at_ms'),
}, (table) => [
  uniqueIndex('recovery_tokens_hash_unique').on(table.tokenHash),
  check('recovery_tokens_hash_check', sql`length(${table.tokenHash}) = 64`),
])

export const securityEvents = sqliteTable('security_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
  actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
  type: text('type').notNull(),
  target: text('target'),
  detailsJson: text('details_json').notNull().default('{}'),
  createdAtMs: integer('created_at_ms').notNull(),
}, (table) => [
  index('security_events_created_index').on(table.createdAtMs),
  check('security_events_details_json_check', sql`json_valid(${table.detailsJson})`),
])

export const oidcTransactions = sqliteTable('oidc_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  state: text('state').notNull(),
  nonce: text('nonce').notNull(),
  codeVerifier: text('code_verifier').notNull(),
  returnTo: text('return_to').notNull(),
  invitationId: integer('invitation_id'),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  usedAtMs: integer('used_at_ms'),
}, (table) => [
  uniqueIndex('oidc_transactions_token_hash_unique').on(table.tokenHash),
  uniqueIndex('oidc_transactions_state_unique').on(table.state),
  check('oidc_transactions_token_hash_check', sql`length(${table.tokenHash}) = 64`),
])

export const roles = sqliteTable('roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  builtIn: integer('built_in', { mode: 'boolean' }).notNull().default(false),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAtMs: integer('created_at_ms').notNull(),
  updatedAtMs: integer('updated_at_ms').notNull(),
}, (table) => [uniqueIndex('roles_key_unique').on(table.key)])

export const permissions = sqliteTable('permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  permissionKey: text('permission_key').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  risk: text('risk').notNull(),
}, (table) => [
  uniqueIndex('permissions_key_unique').on(table.permissionKey),
  check('permissions_risk_check', sql`${table.risk} IN ('standard', 'sensitive', 'elevated')`),
])

export const rolePermissions = sqliteTable('role_permissions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: integer('permission_id').notNull().references(() => permissions.id, { onDelete: 'restrict' }),
}, (table) => [uniqueIndex('role_permissions_relation_unique').on(table.roleId, table.permissionId)])

export const userRoles = sqliteTable('user_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
  scopeKind: text('scope_kind').notNull().default('global'),
  scopeId: integer('scope_id').notNull().default(0),
}, (table) => [
  uniqueIndex('user_roles_relation_unique').on(table.userId, table.roleId, table.scopeKind, table.scopeId),
  check('user_roles_scope_check', sql`${table.scopeKind} = 'global' AND ${table.scopeId} = 0`),
])

export const invitations = sqliteTable('invitations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').notNull(),
  identityType: text('identity_type').notNull(),
  status: text('status').notNull(),
  tokenHash: text('token_hash').notNull(),
  createdByUserId: integer('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  acceptedUserId: integer('accepted_user_id').references(() => users.id, { onDelete: 'set null' }),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  acceptedAtMs: integer('accepted_at_ms'),
  revokedAtMs: integer('revoked_at_ms'),
}, (table) => [
  uniqueIndex('invitations_token_hash_unique').on(table.tokenHash),
  uniqueIndex('invitations_pending_email_unique').on(table.email).where(sql`${table.status} = 'pending'`),
  check('invitations_identity_type_check', sql`${table.identityType} IN ('local', 'oidc')`),
  check('invitations_status_check', sql`${table.status} IN ('pending', 'accepted', 'expired', 'revoked')`),
])

export const invitationRoles = sqliteTable('invitation_roles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  invitationId: integer('invitation_id').notNull().references(() => invitations.id, { onDelete: 'cascade' }),
  roleId: integer('role_id').notNull().references(() => roles.id, { onDelete: 'restrict' }),
}, (table) => [uniqueIndex('invitation_roles_relation_unique').on(table.invitationId, table.roleId)])

export const identityLinkRequests = sqliteTable('identity_link_requests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  identityType: text('identity_type').notNull(),
  status: text('status').notNull(),
  tokenHash: text('token_hash').notNull(),
  detailsJson: text('details_json').notNull().default('{}'),
  createdAtMs: integer('created_at_ms').notNull(),
  expiresAtMs: integer('expires_at_ms').notNull(),
  confirmedAtMs: integer('confirmed_at_ms'),
}, (table) => [
  uniqueIndex('identity_link_requests_hash_unique').on(table.tokenHash),
  check('identity_link_requests_type_check', sql`${table.identityType} IN ('local', 'oidc')`),
  check('identity_link_requests_state_check', sql`${table.status} IN ('pending', 'confirmed', 'expired', 'revoked')`),
  check('identity_link_requests_details_json_check', sql`json_valid(${table.detailsJson})`),
])
