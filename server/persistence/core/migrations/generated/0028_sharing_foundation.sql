CREATE TABLE `sharing_settings` (
  `id` integer PRIMARY KEY NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `connection_enabled` integer NOT NULL DEFAULT 1,
  `enrollment_state` text NOT NULL DEFAULT 'pending',
  `attempt_count` integer NOT NULL DEFAULT 0,
  `next_attempt_at_ms` integer,
  `last_error_code` text,
  `remote_event_cursor` integer NOT NULL DEFAULT 0,
  `recovery_state` text,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `sharing_settings_singleton_check` CHECK (`id` = 1),
  CONSTRAINT `sharing_settings_revision_check` CHECK (`revision` > 0),
  CONSTRAINT `sharing_settings_connection_check` CHECK (`connection_enabled` IN (0, 1)),
  CONSTRAINT `sharing_settings_state_check` CHECK (`enrollment_state` IN ('pending','connected','retrying','recovery-pending','disabled','unsupported')),
  CONSTRAINT `sharing_settings_attempt_check` CHECK (`attempt_count` >= 0),
  CONSTRAINT `sharing_settings_cursor_check` CHECK (`remote_event_cursor` >= 0),
  CONSTRAINT `sharing_settings_recovery_check` CHECK (`recovery_state` IS NULL OR `recovery_state` IN ('pending-owner-approval','approved'))
) STRICT;

INSERT INTO `sharing_settings` (`id`, `created_at_ms`, `updated_at_ms`)
VALUES (1, CAST(unixepoch('subsec') * 1000 AS integer), CAST(unixepoch('subsec') * 1000 AS integer));

CREATE TABLE `sharing_installation_projection` (
  `id` integer PRIMARY KEY NOT NULL,
  `client_instance_id` text NOT NULL,
  `key_id` text NOT NULL,
  `public_key_spki` text NOT NULL,
  `identity_hash` text NOT NULL,
  `remote_installation_id` integer,
  `credential_expires_at_ms` integer,
  `state` text NOT NULL,
  `recovery_public_key_spki` text,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `sharing_installation_projection_singleton_check` CHECK (`id` = 1),
  CONSTRAINT `sharing_installation_projection_remote_id_check` CHECK (`remote_installation_id` IS NULL OR `remote_installation_id` > 0),
  CONSTRAINT `sharing_installation_projection_state_check` CHECK (`state` IN ('local','active','recovery-pending','disabled'))
) STRICT;
CREATE UNIQUE INDEX `sharing_installation_projection_instance_unique` ON `sharing_installation_projection` (`client_instance_id`);
CREATE UNIQUE INDEX `sharing_installation_projection_identity_unique` ON `sharing_installation_projection` (`identity_hash`);

CREATE TABLE `shares` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `projects` (`id`) ON DELETE CASCADE,
  `remote_public_id` text,
  `title` text NOT NULL,
  `description` text NOT NULL DEFAULT '',
  `mutability` text NOT NULL,
  `sync_mode` text NOT NULL,
  `visibility` text NOT NULL,
  `state` text NOT NULL DEFAULT 'unpublished',
  `comments_enabled` integer NOT NULL DEFAULT 0,
  `reactions_enabled` integer NOT NULL DEFAULT 0,
  `embed_enabled` integer NOT NULL DEFAULT 0,
  `embed_origins_json` text NOT NULL DEFAULT '[]',
  `resource_snapshot_included` integer NOT NULL DEFAULT 0,
  `expiration_type` text NOT NULL DEFAULT 'indefinite',
  `expiration_duration_seconds` integer,
  `expires_at_ms` integer,
  `local_revision` integer NOT NULL DEFAULT 1,
  `remote_revision` integer,
  `active_manifest_hash` text,
  `approved_preview_hash` text,
  `account_claimed` integer NOT NULL DEFAULT 0,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `shares_title_check` CHECK (length(trim(`title`)) BETWEEN 1 AND 160),
  CONSTRAINT `shares_description_check` CHECK (length(`description`) <= 10000),
  CONSTRAINT `shares_mutability_check` CHECK (`mutability` IN ('immutable','replaceable')),
  CONSTRAINT `shares_sync_mode_check` CHECK (`sync_mode` IN ('manual','synchronized') AND (`mutability` = 'replaceable' OR `sync_mode` = 'manual')),
  CONSTRAINT `shares_visibility_check` CHECK (`visibility` IN ('public','unlisted','protected')),
  CONSTRAINT `shares_state_check` CHECK (`state` IN ('unpublished','preview-ready','publishing','synced','changes-pending','manual-update-available','failed','expired','grace-period','deleted')),
  CONSTRAINT `shares_expiration_check` CHECK (
    (`expiration_type` = 'indefinite' AND `expiration_duration_seconds` IS NULL AND `expires_at_ms` IS NULL)
    OR (`expiration_type` = 'duration' AND `expiration_duration_seconds` BETWEEN 3600 AND 31536000 AND `expires_at_ms` IS NULL)
    OR (`expiration_type` = 'at' AND `expiration_duration_seconds` IS NULL AND `expires_at_ms` IS NOT NULL)
  ),
  CONSTRAINT `shares_revision_check` CHECK (`local_revision` > 0 AND (`remote_revision` IS NULL OR `remote_revision` > 0)),
  CONSTRAINT `shares_embed_origins_check` CHECK (json_valid(`embed_origins_json`) AND json_type(`embed_origins_json`) = 'array'),
  CONSTRAINT `shares_boolean_check` CHECK (`comments_enabled` IN (0,1) AND `reactions_enabled` IN (0,1) AND `embed_enabled` IN (0,1) AND `resource_snapshot_included` IN (0,1) AND `account_claimed` IN (0,1))
) STRICT;
CREATE UNIQUE INDEX `shares_remote_public_id_unique` ON `shares` (`remote_public_id`);
CREATE INDEX `shares_project_state_index` ON `shares` (`project_id`, `state`, `id`);

CREATE TABLE `share_views` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `workspace_id` integer NOT NULL REFERENCES `workspaces` (`id`) ON DELETE RESTRICT,
  `view_type` text NOT NULL,
  `display_order` integer NOT NULL,
  `created_at_ms` integer NOT NULL,
  CONSTRAINT `share_views_type_check` CHECK (`view_type` IN ('systems','canvas')),
  CONSTRAINT `share_views_order_check` CHECK (`display_order` >= 0)
) STRICT;
CREATE UNIQUE INDEX `share_views_share_workspace_unique` ON `share_views` (`share_id`, `workspace_id`);
CREATE UNIQUE INDEX `share_views_share_order_unique` ON `share_views` (`share_id`, `display_order`);

CREATE TABLE `share_field_selections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `definition_id` integer NOT NULL REFERENCES `custom_field_definitions` (`id`) ON DELETE RESTRICT,
  `created_at_ms` integer NOT NULL
) STRICT;
CREATE UNIQUE INDEX `share_field_selections_unique` ON `share_field_selections` (`share_id`, `definition_id`);

CREATE TABLE `share_tag_selections` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `tag_id` integer NOT NULL REFERENCES `inventory_tags` (`id`) ON DELETE RESTRICT,
  `created_at_ms` integer NOT NULL
) STRICT;
CREATE UNIQUE INDEX `share_tag_selections_unique` ON `share_tag_selections` (`share_id`, `tag_id`);

CREATE TABLE `share_resource_snapshots` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `content_hash` text NOT NULL,
  `payload_json` text NOT NULL,
  `captured_at_ms` integer NOT NULL,
  CONSTRAINT `share_resource_snapshots_payload_check` CHECK (json_valid(`payload_json`))
) STRICT;
CREATE UNIQUE INDEX `share_resource_snapshots_hash_unique` ON `share_resource_snapshots` (`share_id`, `content_hash`);
CREATE INDEX `share_resource_snapshots_latest_index` ON `share_resource_snapshots` (`share_id`, `captured_at_ms`);

CREATE TABLE `share_local_blobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `content_hash` text NOT NULL,
  `media_type` text NOT NULL,
  `content_json` text NOT NULL,
  `byte_length` integer NOT NULL,
  `created_at_ms` integer NOT NULL,
  CONSTRAINT `share_local_blobs_content_check` CHECK (json_valid(`content_json`) AND `byte_length` > 0)
) STRICT;
CREATE UNIQUE INDEX `share_local_blobs_hash_unique` ON `share_local_blobs` (`content_hash`);

CREATE TABLE `share_local_revisions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `revision` integer NOT NULL,
  `manifest_hash` text NOT NULL,
  `manifest_json` text NOT NULL,
  `created_at_ms` integer NOT NULL,
  CONSTRAINT `share_local_revisions_revision_check` CHECK (`revision` > 0),
  CONSTRAINT `share_local_revisions_manifest_check` CHECK (json_valid(`manifest_json`))
) STRICT;
CREATE UNIQUE INDEX `share_local_revisions_number_unique` ON `share_local_revisions` (`share_id`, `revision`);
CREATE UNIQUE INDEX `share_local_revisions_manifest_unique` ON `share_local_revisions` (`share_id`, `manifest_hash`);

CREATE TABLE `share_local_revision_blobs` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `local_revision_id` integer NOT NULL REFERENCES `share_local_revisions` (`id`) ON DELETE CASCADE,
  `blob_id` integer NOT NULL REFERENCES `share_local_blobs` (`id`) ON DELETE RESTRICT
) STRICT;
CREATE UNIQUE INDEX `share_local_revision_blobs_unique` ON `share_local_revision_blobs` (`local_revision_id`, `blob_id`);

CREATE TABLE `share_publication_operations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `share_id` integer NOT NULL REFERENCES `shares` (`id`) ON DELETE CASCADE,
  `local_revision_id` integer REFERENCES `share_local_revisions` (`id`) ON DELETE RESTRICT,
  `idempotency_key` text NOT NULL,
  `kind` text NOT NULL,
  `state` text NOT NULL,
  `attempt_count` integer NOT NULL DEFAULT 0,
  `available_at_ms` integer NOT NULL,
  `remote_operation_id` integer,
  `last_error_code` text,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `share_publication_operations_kind_check` CHECK (`kind` IN ('publish','unpublish','delete','resource-snapshot')),
  CONSTRAINT `share_publication_operations_state_check` CHECK (`state` IN ('queued','running','retrying','succeeded','failed','cancelled')),
  CONSTRAINT `share_publication_operations_attempt_check` CHECK (`attempt_count` >= 0),
  CONSTRAINT `share_publication_operations_remote_id_check` CHECK (`remote_operation_id` IS NULL OR `remote_operation_id` > 0)
) STRICT;
CREATE UNIQUE INDEX `share_publication_operations_idempotency_unique` ON `share_publication_operations` (`idempotency_key`);
CREATE INDEX `share_publication_operations_queue_index` ON `share_publication_operations` (`state`, `available_at_ms`, `id`);
