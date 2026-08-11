CREATE TABLE `agent_enrollment_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`used_at_ms` integer,
	`revoked_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_enrollment_codes_hash_check" CHECK(length("agent_enrollment_codes"."token_hash") = 64)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_enrollment_codes_token_unique` ON `agent_enrollment_codes` (`token_hash`);--> statement-breakpoint
CREATE INDEX `agent_enrollment_codes_host_index` ON `agent_enrollment_codes` (`host_item_id`);--> statement-breakpoint
CREATE TABLE `agent_hardware_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`component_key` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`occurred_at_ms` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `agent_hardware_snapshots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_hardware_events_details_json_check" CHECK(json_valid("agent_hardware_events"."details_json"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `agent_hardware_events_host_index` ON `agent_hardware_events` (`host_item_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE TABLE `agent_hardware_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`payload_json` text NOT NULL,
	`collected_at_ms` integer NOT NULL,
	`received_at_ms` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_hardware_snapshots_sequence_check" CHECK("agent_hardware_snapshots"."sequence" > 0),
	CONSTRAINT "agent_hardware_snapshots_payload_json_check" CHECK(json_valid("agent_hardware_snapshots"."payload_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_hardware_snapshots_agent_sequence_unique` ON `agent_hardware_snapshots` (`agent_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `agent_hardware_snapshots_host_index` ON `agent_hardware_snapshots` (`host_item_id`,`received_at_ms`);--> statement-breakpoint
CREATE TABLE `agent_host_bindings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`state` text NOT NULL,
	`bound_at_ms` integer NOT NULL,
	`unbound_at_ms` integer,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_host_bindings_state_check" CHECK("agent_host_bindings"."state" IN ('active', 'revoked', 'replaced', 'unlinked'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_host_bindings_agent_active_unique` ON `agent_host_bindings` (`agent_id`) WHERE "agent_host_bindings"."state" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX `agent_host_bindings_host_active_unique` ON `agent_host_bindings` (`host_item_id`) WHERE "agent_host_bindings"."state" = 'active';--> statement-breakpoint
CREATE INDEX `agent_host_bindings_host_index` ON `agent_host_bindings` (`host_item_id`);--> statement-breakpoint
CREATE TABLE `agent_monitoring_policies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`heartbeat_interval_seconds` integer DEFAULT 60 NOT NULL,
	`selected_interval_seconds` integer DEFAULT 60 NOT NULL,
	`default_interval_seconds` integer DEFAULT 600 NOT NULL,
	`policy_json` text DEFAULT '{}' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_monitoring_policies_intervals_check" CHECK("agent_monitoring_policies"."revision" > 0 AND "agent_monitoring_policies"."heartbeat_interval_seconds" > 0 AND "agent_monitoring_policies"."selected_interval_seconds" > 0 AND "agent_monitoring_policies"."default_interval_seconds" > 0),
	CONSTRAINT "agent_monitoring_policies_json_check" CHECK(json_valid("agent_monitoring_policies"."policy_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_monitoring_policies_host_revision_unique` ON `agent_monitoring_policies` (`host_item_id`,`revision`);--> statement-breakpoint
CREATE TABLE `agents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`public_key` text NOT NULL,
	`protocol_major` integer NOT NULL,
	`agent_version` text NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`last_seen_at_ms` integer,
	`revoked_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "agents_protocol_check" CHECK("agents"."protocol_major" > 0 AND "agents"."last_sequence" >= 0),
	CONSTRAINT "agents_capabilities_json_check" CHECK(json_valid("agents"."capabilities_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_public_key_unique` ON `agents` (`public_key`);--> statement-breakpoint
CREATE TABLE `authentication_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`local_enabled` integer DEFAULT false NOT NULL,
	`oidc_enabled` integer DEFAULT false NOT NULL,
	`oidc_issuer` text,
	`oidc_client_id` text,
	`oidc_scopes_json` text DEFAULT '["openid","profile","email"]' NOT NULL,
	`oidc_external_url` text,
	`oidc_client_secret_configured` integer DEFAULT false NOT NULL,
	`setup_required` integer DEFAULT false NOT NULL,
	`setup_completed_at_ms` integer,
	`updated_at_ms` integer,
	CONSTRAINT "authentication_settings_singleton_check" CHECK("authentication_settings"."id" = 1),
	CONSTRAINT "authentication_settings_method_check" CHECK("authentication_settings"."enabled" = 0 OR "authentication_settings"."local_enabled" = 1 OR "authentication_settings"."oidc_enabled" = 1),
	CONSTRAINT "authentication_settings_scopes_json_check" CHECK(json_valid("authentication_settings"."oidc_scopes_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`type` text NOT NULL,
	`secret_hash` text NOT NULL,
	`algorithm` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "credentials_type_check" CHECK("credentials"."type" IN ('password'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `credentials_user_type_unique` ON `credentials` (`user_id`,`type`);--> statement-breakpoint
CREATE TABLE `identity_link_requests` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`identity_type` text NOT NULL,
	`status` text NOT NULL,
	`token_hash` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`confirmed_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "identity_link_requests_type_check" CHECK("identity_link_requests"."identity_type" IN ('local', 'oidc')),
	CONSTRAINT "identity_link_requests_state_check" CHECK("identity_link_requests"."status" IN ('pending', 'confirmed', 'expired', 'revoked')),
	CONSTRAINT "identity_link_requests_details_json_check" CHECK(json_valid("identity_link_requests"."details_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `identity_link_requests_hash_unique` ON `identity_link_requests` (`token_hash`);--> statement-breakpoint
CREATE TABLE `invitation_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`invitation_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	FOREIGN KEY (`invitation_id`) REFERENCES `invitations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `invitation_roles_relation_unique` ON `invitation_roles` (`invitation_id`,`role_id`);--> statement-breakpoint
CREATE TABLE `invitations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`identity_type` text NOT NULL,
	`status` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_by_user_id` integer NOT NULL,
	`accepted_user_id` integer,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`accepted_at_ms` integer,
	`revoked_at_ms` integer,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`accepted_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "invitations_identity_type_check" CHECK("invitations"."identity_type" IN ('local', 'oidc')),
	CONSTRAINT "invitations_status_check" CHECK("invitations"."status" IN ('pending', 'accepted', 'expired', 'revoked'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_token_hash_unique` ON `invitations` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `invitations_pending_email_unique` ON `invitations` (`email`) WHERE "invitations"."status" = 'pending';--> statement-breakpoint
CREATE TABLE `oidc_transactions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`token_hash` text NOT NULL,
	`state` text NOT NULL,
	`nonce` text NOT NULL,
	`code_verifier` text NOT NULL,
	`return_to` text NOT NULL,
	`invitation_id` integer,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`used_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "oidc_transactions_token_hash_check" CHECK(length("oidc_transactions"."token_hash") = 64)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_transactions_token_hash_unique` ON `oidc_transactions` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `oidc_transactions_state_unique` ON `oidc_transactions` (`state`);--> statement-breakpoint
CREATE TABLE `permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`permission_key` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`risk` text NOT NULL,
	CONSTRAINT "permissions_risk_check" CHECK("permissions"."risk" IN ('standard', 'sensitive', 'elevated'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_key_unique` ON `permissions` (`permission_key`);--> statement-breakpoint
CREATE TABLE `recovery_tokens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`token_hash` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`used_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recovery_tokens_hash_check" CHECK(length("recovery_tokens"."token_hash") = 64)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `recovery_tokens_hash_unique` ON `recovery_tokens` (`token_hash`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`role_id` integer NOT NULL,
	`permission_id` integer NOT NULL,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permission_id`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `role_permissions_relation_unique` ON `role_permissions` (`role_id`,`permission_id`);--> statement-breakpoint
CREATE TABLE `roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`built_in` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `roles_key_unique` ON `roles` (`key`);--> statement-breakpoint
CREATE TABLE `security_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer,
	`actor_user_id` integer,
	`type` text NOT NULL,
	`target` text,
	`details_json` text DEFAULT '{}' NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "security_events_details_json_check" CHECK(json_valid("security_events"."details_json"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `security_events_created_index` ON `security_events` (`created_at_ms`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`token_hash` text NOT NULL,
	`remember` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	`idle_expires_at_ms` integer NOT NULL,
	`absolute_expires_at_ms` integer NOT NULL,
	`revoked_at_ms` integer,
	`user_agent_hash` text,
	`ip_hash` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "sessions_token_hash_check" CHECK(length("sessions"."token_hash") = 64),
	CONSTRAINT "sessions_expiry_check" CHECK("sessions"."created_at_ms" <= "sessions"."idle_expires_at_ms" AND "sessions"."idle_expires_at_ms" <= "sessions"."absolute_expires_at_ms")
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_index` ON `sessions` (`user_id`,`revoked_at_ms`);--> statement-breakpoint
CREATE TABLE `user_identities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`provider` text NOT NULL,
	`issuer` text NOT NULL,
	`subject` text NOT NULL,
	`email` text,
	`created_at_ms` integer NOT NULL,
	`last_login_at_ms` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_identities_provider_check" CHECK("user_identities"."provider" IN ('oidc'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_identities_provider_subject_unique` ON `user_identities` (`provider`,`issuer`,`subject`);--> statement-breakpoint
CREATE INDEX `user_identities_user_index` ON `user_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`role_id` integer NOT NULL,
	`scope_kind` text DEFAULT 'global' NOT NULL,
	`scope_id` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`role_id`) REFERENCES `roles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "user_roles_scope_check" CHECK("user_roles"."scope_kind" = 'global' AND "user_roles"."scope_id" = 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_roles_relation_unique` ON `user_roles` (`user_id`,`role_id`,`scope_kind`,`scope_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`protected_owner` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`) WHERE "users"."email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `users_protected_owner_unique` ON `users` (`protected_owner`) WHERE "users"."protected_owner" = 1;--> statement-breakpoint
CREATE TABLE `compatibility_audit_findings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`component_item_id` integer,
	`finding_key` text NOT NULL,
	`rule_key` text NOT NULL,
	`severity` text NOT NULL,
	`message` text NOT NULL,
	`details_json` text DEFAULT '{}' NOT NULL,
	`first_seen_at_ms` integer NOT NULL,
	`last_seen_at_ms` integer NOT NULL,
	`resolved_at_ms` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`component_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "compatibility_audit_findings_severity_check" CHECK("compatibility_audit_findings"."severity" IN ('info', 'warning', 'error')),
	CONSTRAINT "compatibility_audit_findings_details_json_check" CHECK(json_valid("compatibility_audit_findings"."details_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_audit_findings_project_key_unique` ON `compatibility_audit_findings` (`project_id`,`finding_key`);--> statement-breakpoint
CREATE INDEX `compatibility_audit_findings_host_index` ON `compatibility_audit_findings` (`project_id`,`host_item_id`,`resolved_at_ms`);--> statement-breakpoint
CREATE TABLE `compatibility_audit_ignores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`finding_id` integer NOT NULL,
	`ignored_by_user_id` integer,
	`reason` text,
	`ignored_at_ms` integer NOT NULL,
	FOREIGN KEY (`finding_id`) REFERENCES `compatibility_audit_findings`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ignored_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_audit_ignores_finding_unique` ON `compatibility_audit_ignores` (`finding_id`);--> statement-breakpoint
CREATE TABLE `compatibility_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`state` text NOT NULL,
	`input_revision` integer NOT NULL,
	`engine_version` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "compatibility_audits_state_check" CHECK("compatibility_audits"."state" IN ('running', 'completed', 'failed')),
	CONSTRAINT "compatibility_audits_revision_check" CHECK("compatibility_audits"."input_revision" > 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `compatibility_audits_project_index` ON `compatibility_audits` (`project_id`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `backup_operations` (
	`id` integer PRIMARY KEY NOT NULL,
	`operation_type` text NOT NULL,
	`related_record_id` integer,
	`state` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	CONSTRAINT "backup_operations_singleton_check" CHECK("backup_operations"."id" = 1),
	CONSTRAINT "backup_operations_type_check" CHECK("backup_operations"."operation_type" IN ('backup', 'restore')),
	CONSTRAINT "backup_operations_state_check" CHECK("backup_operations"."state" IN ('running'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `backup_restore_journal` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backup_run_id` integer,
	`state` text NOT NULL,
	`format_version` integer NOT NULL,
	`selected_sections_json` text NOT NULL,
	`staging_path` text,
	`source_digest` text,
	`target_digest` text,
	`error_code` text,
	`started_by_user_id` integer,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	FOREIGN KEY (`backup_run_id`) REFERENCES `backup_runs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "backup_restore_journal_state_check" CHECK("backup_restore_journal"."state" IN ('preparing', 'validating', 'staging', 'restoring', 'verified', 'rolled-back', 'failed')),
	CONSTRAINT "backup_restore_journal_format_check" CHECK("backup_restore_journal"."format_version" > 0),
	CONSTRAINT "backup_restore_journal_sections_json_check" CHECK(json_valid("backup_restore_journal"."selected_sections_json"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `backup_restore_journal_state_index` ON `backup_restore_journal` (`state`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`state` text NOT NULL,
	`format_version` integer NOT NULL,
	`selected_sections_json` text NOT NULL,
	`path` text,
	`size_bytes` integer,
	`digest` text,
	`error_code` text,
	`started_by_user_id` integer,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	FOREIGN KEY (`started_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "backup_runs_kind_check" CHECK("backup_runs"."kind" IN ('manual', 'scheduled', 'pre-migration', 'pre-restore')),
	CONSTRAINT "backup_runs_state_check" CHECK("backup_runs"."state" IN ('preparing', 'writing', 'verified', 'failed', 'deleted')),
	CONSTRAINT "backup_runs_format_check" CHECK("backup_runs"."format_version" > 0),
	CONSTRAINT "backup_runs_sections_json_check" CHECK(json_valid("backup_runs"."selected_sections_json")),
	CONSTRAINT "backup_runs_size_check" CHECK("backup_runs"."size_bytes" IS NULL OR "backup_runs"."size_bytes" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `backup_runs_state_index` ON `backup_runs` (`state`,`started_at_ms`);--> statement-breakpoint
CREATE TABLE `backup_schedules` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`frequency` text DEFAULT 'daily' NOT NULL,
	`local_time` text DEFAULT '02:00' NOT NULL,
	`weekday` integer DEFAULT 0 NOT NULL,
	`timezone` text,
	`retention_count` integer DEFAULT 7 NOT NULL,
	`next_run_at_ms` integer,
	`last_run_at_ms` integer,
	`last_result` text,
	`updated_at_ms` integer,
	CONSTRAINT "backup_schedules_singleton_check" CHECK("backup_schedules"."id" = 1),
	CONSTRAINT "backup_schedules_frequency_check" CHECK("backup_schedules"."frequency" IN ('daily', 'weekly')),
	CONSTRAINT "backup_schedules_time_check" CHECK(
    length("backup_schedules"."local_time") = 5
    AND substr("backup_schedules"."local_time", 3, 1) = ':'
    AND CAST(substr("backup_schedules"."local_time", 1, 2) AS INTEGER) BETWEEN 0 AND 23
    AND CAST(substr("backup_schedules"."local_time", 4, 2) AS INTEGER) BETWEEN 0 AND 59
  ),
	CONSTRAINT "backup_schedules_weekday_check" CHECK("backup_schedules"."weekday" BETWEEN 0 AND 6),
	CONSTRAINT "backup_schedules_retention_check" CHECK("backup_schedules"."retention_count" BETWEEN 1 AND 365)
) STRICT;
--> statement-breakpoint
CREATE TABLE `incident_acknowledgements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`user_id` integer,
	`note` text,
	`acknowledged_at_ms` integer NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
) STRICT;
--> statement-breakpoint
CREATE INDEX `incident_acknowledgements_incident_index` ON `incident_acknowledgements` (`incident_id`);--> statement-breakpoint
CREATE TABLE `incident_transitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`from_state` text,
	`to_state` text NOT NULL,
	`reason` text,
	`occurred_at_ms` integer NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `incident_transitions_incident_index` ON `incident_transitions` (`incident_id`,`occurred_at_ms`);--> statement-breakpoint
CREATE TABLE `incidents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`monitored_resource_id` integer,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`title` text NOT NULL,
	`summary` text NOT NULL,
	`state` text NOT NULL,
	`opened_at_ms` integer NOT NULL,
	`resolved_at_ms` integer,
	`notification_delivered_at_ms` integer,
	`last_reminder_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`monitored_resource_id`) REFERENCES `notification_monitored_resources`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "incidents_type_check" CHECK("incidents"."event_type" IN ('host.offline', 'service.unhealthy', 'container.unhealthy', 'container.missing', 'storage.warning', 'storage.failed')),
	CONSTRAINT "incidents_severity_check" CHECK("incidents"."severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "incidents_state_check" CHECK("incidents"."state" IN ('pending', 'open', 'resolved', 'cancelled'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `incidents_active_event_unique` ON `incidents` (`event_key`) WHERE "incidents"."state" IN ('pending', 'open');--> statement-breakpoint
CREATE INDEX `incidents_state_index` ON `incidents` (`state`,`updated_at_ms`);--> statement-breakpoint
CREATE TABLE `notification_contact_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`secret_id` integer,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`secret_id`) REFERENCES `notification_secrets`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "notification_contact_points_type_check" CHECK("notification_contact_points"."type" IN ('ntfy', 'webhook')),
	CONSTRAINT "notification_contact_points_config_json_check" CHECK(json_valid("notification_contact_points"."config_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_contact_points_name_unique` ON `notification_contact_points` (`name`);--> statement-breakpoint
CREATE TABLE `notification_cooldowns` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`monitored_resource_id` integer,
	`contact_point_id` integer NOT NULL,
	`event_type` text NOT NULL,
	`expires_at_ms` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitored_resource_id`) REFERENCES `notification_monitored_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_point_id`) REFERENCES `notification_contact_points`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_cooldowns_event_unique` ON `notification_cooldowns` (`host_item_id`,`monitored_resource_id`,`contact_point_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `notification_deliveries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`incident_id` integer NOT NULL,
	`contact_point_id` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at_ms` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at_ms` integer,
	`delivered_at_ms` integer,
	`last_error` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`incident_id`) REFERENCES `incidents`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_point_id`) REFERENCES `notification_contact_points`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "notification_deliveries_kind_check" CHECK("notification_deliveries"."kind" IN ('opening', 'reminder', 'recovery')),
	CONSTRAINT "notification_deliveries_state_check" CHECK("notification_deliveries"."state" IN ('queued', 'leased', 'delivered', 'retrying', 'exhausted', 'cancelled'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_deliveries_idempotency_unique` ON `notification_deliveries` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `notification_deliveries_queue_index` ON `notification_deliveries` (`state`,`available_at_ms`);--> statement-breakpoint
CREATE TABLE `notification_delivery_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`delivery_id` integer NOT NULL,
	`attempt_number` integer NOT NULL,
	`state` text NOT NULL,
	`status_code` integer,
	`error_code` text,
	`attempted_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	FOREIGN KEY (`delivery_id`) REFERENCES `notification_deliveries`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_delivery_attempts_number_check" CHECK("notification_delivery_attempts"."attempt_number" > 0),
	CONSTRAINT "notification_delivery_attempts_state_check" CHECK("notification_delivery_attempts"."state" IN ('delivered', 'failed', 'cancelled'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_attempts_number_unique` ON `notification_delivery_attempts` (`delivery_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `notification_evaluation_cursors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`last_collected_at_ms` integer,
	`last_received_at_ms` integer,
	`candidate_collected_at_ms` integer,
	`candidate_received_at_ms` integer,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_evaluation_cursors_sequence_check" CHECK("notification_evaluation_cursors"."last_sequence" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_evaluation_cursors_host_unique` ON `notification_evaluation_cursors` (`host_item_id`);--> statement-breakpoint
CREATE TABLE `notification_host_override_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_override_id` integer NOT NULL,
	`monitored_resource_id` integer NOT NULL,
	FOREIGN KEY (`host_override_id`) REFERENCES `notification_host_overrides`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitored_resource_id`) REFERENCES `notification_monitored_resources`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_host_override_resources_unique` ON `notification_host_override_resources` (`host_override_id`,`monitored_resource_id`);--> statement-breakpoint
CREATE TABLE `notification_host_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`mode` text NOT NULL,
	`muted_until_ms` integer,
	`rules_json` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_host_overrides_mode_check" CHECK("notification_host_overrides"."mode" IN ('inherit', 'custom', 'disabled')),
	CONSTRAINT "notification_host_overrides_rules_json_check" CHECK(json_valid("notification_host_overrides"."rules_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_host_overrides_host_unique` ON `notification_host_overrides` (`host_item_id`);--> statement-breakpoint
CREATE TABLE `notification_monitored_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`family` text NOT NULL,
	`resource_key` text NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_monitored_resources_family_check" CHECK("notification_monitored_resources"."family" IN ('service', 'container', 'storage-health'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_monitored_resources_unique` ON `notification_monitored_resources` (`host_item_id`,`family`,`resource_key`);--> statement-breakpoint
CREATE TABLE `notification_normalized_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`monitored_resource_id` integer,
	`event_type` text NOT NULL,
	`state` text NOT NULL,
	`sequence` integer,
	`observed_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitored_resource_id`) REFERENCES `notification_monitored_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_normalized_states_state_check" CHECK("notification_normalized_states"."state" IN ('healthy', 'problem', 'unknown')),
	CONSTRAINT "notification_normalized_states_sequence_check" CHECK("notification_normalized_states"."sequence" IS NULL OR "notification_normalized_states"."sequence" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_normalized_states_event_unique` ON `notification_normalized_states` (`host_item_id`,`monitored_resource_id`,`event_type`);--> statement-breakpoint
CREATE TABLE `notification_pending_transitions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`monitored_resource_id` integer,
	`event_key` text NOT NULL,
	`event_type` text NOT NULL,
	`candidate_state` text NOT NULL,
	`first_observed_at_ms` integer NOT NULL,
	`last_observed_at_ms` integer NOT NULL,
	`observation_count` integer DEFAULT 1 NOT NULL,
	`due_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`monitored_resource_id`) REFERENCES `notification_monitored_resources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_pending_transitions_state_check" CHECK("notification_pending_transitions"."candidate_state" IN ('healthy', 'problem')),
	CONSTRAINT "notification_pending_transitions_count_check" CHECK("notification_pending_transitions"."observation_count" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_pending_transitions_event_unique` ON `notification_pending_transitions` (`event_key`);--> statement-breakpoint
CREATE INDEX `notification_pending_transitions_due_index` ON `notification_pending_transitions` (`due_at_ms`);--> statement-breakpoint
CREATE TABLE `notification_quiet_hours` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`timezone` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`weekdays_json` text NOT NULL,
	CONSTRAINT "notification_quiet_hours_start_check" CHECK("notification_quiet_hours"."start_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "notification_quiet_hours_end_check" CHECK("notification_quiet_hours"."end_time" GLOB '[0-2][0-9]:[0-5][0-9]'),
	CONSTRAINT "notification_quiet_hours_weekdays_json_check" CHECK(json_valid("notification_quiet_hours"."weekdays_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `notification_rule_contact_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` integer NOT NULL,
	`contact_point_id` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `notification_rules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_point_id`) REFERENCES `notification_contact_points`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_rule_contact_points_unique` ON `notification_rule_contact_points` (`rule_id`,`contact_point_id`);--> statement-breakpoint
CREATE TABLE `notification_rules` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`event_type` text NOT NULL,
	`severity` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`debounce_seconds` integer NOT NULL,
	`cooldown_seconds` integer NOT NULL,
	`reminder_interval_seconds` integer,
	CONSTRAINT "notification_rules_event_check" CHECK("notification_rules"."event_type" IN ('host.offline', 'service.unhealthy', 'container.unhealthy', 'container.missing', 'storage.warning', 'storage.failed')),
	CONSTRAINT "notification_rules_severity_check" CHECK("notification_rules"."severity" IN ('info', 'warning', 'critical')),
	CONSTRAINT "notification_rules_timing_check" CHECK("notification_rules"."debounce_seconds" >= 0 AND "notification_rules"."cooldown_seconds" >= 0 AND ("notification_rules"."reminder_interval_seconds" IS NULL OR "notification_rules"."reminder_interval_seconds" > 0))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_rules_event_unique` ON `notification_rules` (`event_type`);--> statement-breakpoint
CREATE TABLE `notification_secrets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`algorithm` text NOT NULL,
	`iv` text NOT NULL,
	`auth_tag` text NOT NULL,
	`ciphertext` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "notification_secrets_algorithm_check" CHECK("notification_secrets"."algorithm" = 'aes-256-gcm')
) STRICT;
--> statement-breakpoint
CREATE TABLE `notification_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`incident_retention_days` integer DEFAULT 90 NOT NULL,
	`delivery_attempt_retention_days` integer DEFAULT 30 NOT NULL,
	`last_evaluated_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "notification_settings_singleton_check" CHECK("notification_settings"."id" = 1),
	CONSTRAINT "notification_settings_values_check" CHECK("notification_settings"."revision" > 0 AND "notification_settings"."incident_retention_days" > 0 AND "notification_settings"."delivery_attempt_retention_days" > 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `registry_catalog_adoption_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`catalog_revision` integer NOT NULL,
	`application_version` text NOT NULL,
	`reported_at_ms` integer NOT NULL,
	`last_error` text,
	FOREIGN KEY (`source_id`) REFERENCES `registry_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_catalog_adoption_status_revision_check" CHECK("registry_catalog_adoption_status"."catalog_revision" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_catalog_adoption_status_source_unique` ON `registry_catalog_adoption_status` (`source_id`);--> statement-breakpoint
CREATE TABLE `registry_contribution_group_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `registry_contribution_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_contribution_group_items_unique` ON `registry_contribution_group_items` (`group_id`,`item_id`);--> statement-breakpoint
CREATE TABLE `registry_contribution_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`identity_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`payload_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "registry_contribution_groups_payload_json_check" CHECK(json_valid("registry_contribution_groups"."payload_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_contribution_groups_identity_content_unique` ON `registry_contribution_groups` (`identity_hash`,`content_hash`);--> statement-breakpoint
CREATE TABLE `registry_contribution_ledger` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`identity_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`state` text NOT NULL,
	`remote_candidate_key` text,
	`delivered_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_contribution_ledger_state_check" CHECK("registry_contribution_ledger"."state" IN ('delivered', 'accepted', 'rejected', 'suppressed'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_contribution_ledger_item_content_unique` ON `registry_contribution_ledger` (`item_id`,`content_hash`);--> statement-breakpoint
CREATE TABLE `registry_contribution_outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`state` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`available_at_ms` integer NOT NULL,
	`last_error` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `registry_contribution_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_contribution_outbox_state_check" CHECK("registry_contribution_outbox"."state" IN ('queued', 'retrying', 'delivering'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_contribution_outbox_group_unique` ON `registry_contribution_outbox` (`group_id`);--> statement-breakpoint
CREATE INDEX `registry_contribution_outbox_delivery_index` ON `registry_contribution_outbox` (`state`,`available_at_ms`);--> statement-breakpoint
CREATE TABLE `registry_installation_projection` (
	`id` integer PRIMARY KEY NOT NULL,
	`client_instance_id` text NOT NULL,
	`installation_key` text NOT NULL,
	`public_key_id` text NOT NULL,
	`state` text NOT NULL,
	`recovery_key` text,
	`last_error` text,
	`activated_at_ms` integer,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "registry_installation_projection_singleton_check" CHECK("registry_installation_projection"."id" = 1),
	CONSTRAINT "registry_installation_projection_state_check" CHECK("registry_installation_projection"."state" IN ('active', 'recovery-pending', 'rejected', 'revoked'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_installation_projection_instance_unique` ON `registry_installation_projection` (`client_instance_id`);--> statement-breakpoint
CREATE TABLE `registry_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`template_key` text NOT NULL,
	`imported_revision` integer NOT NULL,
	`imported_content_hash` text NOT NULL,
	`imported_fingerprint_version` integer DEFAULT 1 NOT NULL,
	`available_revision` integer,
	`state` text NOT NULL,
	`linked_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `registry_sources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "registry_links_revision_check" CHECK("registry_links"."imported_revision" > 0 AND ("registry_links"."available_revision" IS NULL OR "registry_links"."available_revision" > 0)),
	CONSTRAINT "registry_links_hash_check" CHECK(length("registry_links"."imported_content_hash") = 64),
	CONSTRAINT "registry_links_state_check" CHECK("registry_links"."state" IN ('linked', 'update-available', 'adoption-available', 'detached', 'contribution-pending'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_links_item_unique` ON `registry_links` (`item_id`);--> statement-breakpoint
CREATE INDEX `registry_links_template_index` ON `registry_links` (`source_id`,`template_key`);--> statement-breakpoint
CREATE TABLE `registry_private_templates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`checksum` text NOT NULL,
	`item_json` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "registry_private_templates_item_json_check" CHECK(json_valid("registry_private_templates"."item_json")),
	CONSTRAINT "registry_private_templates_checksum_check" CHECK(length("registry_private_templates"."checksum") = 64)
) STRICT;
--> statement-breakpoint
CREATE TABLE `registry_projection_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`identity_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`projection_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_projection_cache_json_check" CHECK(json_valid("registry_projection_cache"."projection_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_projection_cache_item_unique` ON `registry_projection_cache` (`item_id`);--> statement-breakpoint
CREATE TABLE `registry_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'disabled' NOT NULL,
	`default_inventory_source` text DEFAULT 'catalog' NOT NULL,
	`automatic_contributions` integer DEFAULT false NOT NULL,
	`show_link_indicators` integer DEFAULT false NOT NULL,
	`updated_at_ms` integer,
	CONSTRAINT "registry_settings_singleton_check" CHECK("registry_settings"."id" = 1),
	CONSTRAINT "registry_settings_mode_check" CHECK("registry_settings"."mode" IN ('disabled', 'offline', 'connected')),
	CONSTRAINT "registry_settings_source_tab_check" CHECK("registry_settings"."default_inventory_source" IN ('catalog', 'manual', 'private-templates')),
	CONSTRAINT "registry_settings_contribution_mode_check" CHECK("registry_settings"."automatic_contributions" = 0 OR "registry_settings"."mode" = 'connected')
) STRICT;
--> statement-breakpoint
CREATE TABLE `registry_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`revision` integer NOT NULL,
	`template_count` integer NOT NULL,
	`digest` text NOT NULL,
	`key_id` text NOT NULL,
	`activated_at_ms` integer NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `registry_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_snapshots_revision_check" CHECK("registry_snapshots"."revision" > 0 AND "registry_snapshots"."template_count" >= 0),
	CONSTRAINT "registry_snapshots_metadata_json_check" CHECK(json_valid("registry_snapshots"."metadata_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_snapshots_source_revision_unique` ON `registry_snapshots` (`source_id`,`revision`);--> statement-breakpoint
CREATE TABLE `registry_sources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`display_name` text NOT NULL,
	`endpoint` text,
	`trusted_key_id` text,
	`enabled` integer DEFAULT true NOT NULL,
	`last_checked_at_ms` integer,
	`last_success_at_ms` integer,
	`last_error` text,
	`created_at_ms` integer NOT NULL,
	CONSTRAINT "registry_sources_kind_check" CHECK("registry_sources"."kind" IN ('official-connected', 'official-offline', 'private'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_sources_identity_unique` ON `registry_sources` (`kind`,`endpoint`);--> statement-breakpoint
CREATE TABLE `registry_variant_matches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`source_id` integer NOT NULL,
	`fingerprint_version` integer NOT NULL,
	`local_content_hash` text NOT NULL,
	`product_family_json` text NOT NULL,
	`candidates_json` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_id`) REFERENCES `registry_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_variant_matches_hash_check" CHECK(length("registry_variant_matches"."local_content_hash") = 64),
	CONSTRAINT "registry_variant_matches_product_json_check" CHECK(json_valid("registry_variant_matches"."product_family_json")),
	CONSTRAINT "registry_variant_matches_candidates_json_check" CHECK(json_valid("registry_variant_matches"."candidates_json") AND json_array_length("registry_variant_matches"."candidates_json") >= 2)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_variant_matches_item_source_unique` ON `registry_variant_matches` (`item_id`,`source_id`);--> statement-breakpoint
CREATE TABLE `application_configuration` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "application_configuration_singleton_check" CHECK("application_configuration"."id" = 1),
	CONSTRAINT "application_configuration_revision_check" CHECK("application_configuration"."revision" > 0),
	CONSTRAINT "application_configuration_json_check" CHECK(json_valid("application_configuration"."settings_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `setting_source_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`domain` text NOT NULL,
	`setting_key` text NOT NULL,
	`source` text NOT NULL,
	`environment_variable` text,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "setting_source_metadata_source_check" CHECK("setting_source_metadata"."source" IN ('database', 'environment', 'default')),
	CONSTRAINT "setting_source_metadata_environment_check" CHECK(
    ("setting_source_metadata"."source" = 'environment' AND "setting_source_metadata"."environment_variable" IS NOT NULL)
    OR ("setting_source_metadata"."source" <> 'environment' AND "setting_source_metadata"."environment_variable" IS NULL)
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `setting_source_metadata_domain_key_unique` ON `setting_source_metadata` (`domain`,`setting_key`);
--> statement-breakpoint
CREATE TRIGGER `users_protected_owner_delete_guard`
BEFORE DELETE ON `users`
WHEN OLD.`protected_owner` = 1
BEGIN
	SELECT RAISE(ABORT, 'The protected owner cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER `users_protected_owner_update_guard`
BEFORE UPDATE OF `protected_owner`, `active` ON `users`
WHEN OLD.`protected_owner` = 1
	AND (NEW.`protected_owner` <> 1 OR NEW.`active` <> 1)
BEGIN
	SELECT RAISE(ABORT, 'The protected owner must remain active and protected.');
END;
--> statement-breakpoint
CREATE TRIGGER `user_roles_protected_owner_delete_guard`
BEFORE DELETE ON `user_roles`
WHEN EXISTS (
	SELECT 1 FROM `users`
	JOIN `roles` ON `roles`.`id` = OLD.`role_id`
	WHERE `users`.`id` = OLD.`user_id`
		AND `users`.`protected_owner` = 1
		AND `roles`.`key` = 'owner'
)
BEGIN
	SELECT RAISE(ABORT, 'The protected owner must retain the Owner role.');
END;
--> statement-breakpoint
CREATE TRIGGER `user_roles_protected_owner_update_guard`
BEFORE UPDATE OF `user_id`, `role_id`, `scope_kind`, `scope_id` ON `user_roles`
WHEN EXISTS (
	SELECT 1 FROM `users`
	JOIN `roles` ON `roles`.`id` = OLD.`role_id`
	WHERE `users`.`id` = OLD.`user_id`
		AND `users`.`protected_owner` = 1
		AND `roles`.`key` = 'owner'
) AND (
	NEW.`user_id` <> OLD.`user_id`
	OR NEW.`role_id` <> OLD.`role_id`
	OR NEW.`scope_kind` <> 'global'
	OR NEW.`scope_id` <> 0
)
BEGIN
	SELECT RAISE(ABORT, 'The protected owner must retain the Owner role.');
END;
--> statement-breakpoint
CREATE TRIGGER `roles_builtin_delete_guard`
BEFORE DELETE ON `roles`
WHEN OLD.`built_in` = 1
BEGIN
	SELECT RAISE(ABORT, 'Built-in roles cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER `agent_host_bindings_host_type_guard`
BEFORE INSERT ON `agent_host_bindings`
WHEN NOT EXISTS (SELECT 1 FROM `servers` WHERE `id` = NEW.`host_item_id`)
	AND NOT EXISTS (SELECT 1 FROM `nas_systems` WHERE `id` = NEW.`host_item_id`)
	AND NOT EXISTS (SELECT 1 FROM `pc_builds` WHERE `id` = NEW.`host_item_id`)
BEGIN
	SELECT RAISE(ABORT, 'Agents can bind only to compute hosts.');
END;
--> statement-breakpoint
CREATE TRIGGER `notification_resources_host_type_guard`
BEFORE INSERT ON `notification_monitored_resources`
WHEN NOT EXISTS (SELECT 1 FROM `servers` WHERE `id` = NEW.`host_item_id`)
	AND NOT EXISTS (SELECT 1 FROM `nas_systems` WHERE `id` = NEW.`host_item_id`)
	AND NOT EXISTS (SELECT 1 FROM `pc_builds` WHERE `id` = NEW.`host_item_id`)
BEGIN
	SELECT RAISE(ABORT, 'Notifications can monitor resources only on compute hosts.');
END;
