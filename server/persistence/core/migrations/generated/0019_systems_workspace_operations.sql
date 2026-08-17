CREATE TABLE `systems_saved_views` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `owner_scope` text NOT NULL,
  `account_id` integer REFERENCES `users`(`id`) ON DELETE CASCADE,
  `name` text NOT NULL,
  `sort_key` text NOT NULL,
  `sort_direction` text NOT NULL,
  `density` text NOT NULL,
  `is_default` integer NOT NULL DEFAULT 0,
  `revision` integer NOT NULL DEFAULT 1,
  `created_at_ms` integer NOT NULL,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `systems_saved_views_owner_check` CHECK (
    (`owner_scope` = 'account' AND `account_id` IS NOT NULL) OR
    (`owner_scope` = 'open-installation' AND `account_id` IS NULL)
  ),
  CONSTRAINT `systems_saved_views_name_check` CHECK (length(trim(`name`)) BETWEEN 1 AND 80),
  CONSTRAINT `systems_saved_views_sort_key_check` CHECK (`sort_key` IN (
    'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
    'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp'
  )),
  CONSTRAINT `systems_saved_views_sort_direction_check` CHECK (`sort_direction` IN ('ascending', 'descending')),
  CONSTRAINT `systems_saved_views_density_check` CHECK (`density` IN ('dense', 'comfortable')),
  CONSTRAINT `systems_saved_views_default_check` CHECK (`is_default` IN (0, 1)),
  CONSTRAINT `systems_saved_views_revision_check` CHECK (`revision` > 0)
) STRICT;

CREATE UNIQUE INDEX `systems_saved_views_account_name_unique`
  ON `systems_saved_views` (`project_id`, `account_id`, lower(`name`))
  WHERE `owner_scope` = 'account';
CREATE UNIQUE INDEX `systems_saved_views_open_name_unique`
  ON `systems_saved_views` (`project_id`, lower(`name`))
  WHERE `owner_scope` = 'open-installation';
CREATE UNIQUE INDEX `systems_saved_views_account_default_unique`
  ON `systems_saved_views` (`project_id`, `account_id`)
  WHERE `owner_scope` = 'account' AND `is_default` = 1;
CREATE UNIQUE INDEX `systems_saved_views_open_default_unique`
  ON `systems_saved_views` (`project_id`)
  WHERE `owner_scope` = 'open-installation' AND `is_default` = 1;
CREATE INDEX `systems_saved_views_project_owner_index`
  ON `systems_saved_views` (`project_id`, `owner_scope`, `account_id`, `updated_at_ms`);

CREATE TABLE `systems_saved_view_filters` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `saved_view_id` integer NOT NULL REFERENCES `systems_saved_views`(`id`) ON DELETE CASCADE,
  `filter_category` text NOT NULL,
  `filter_value` text NOT NULL,
  CONSTRAINT `systems_saved_view_filters_category_check` CHECK (`filter_category` IN ('type', 'registration', 'registry')),
  CONSTRAINT `systems_saved_view_filters_value_check` CHECK (
    (`filter_category` = 'type' AND `filter_value` IN ('server', 'nas', 'pcBuild')) OR
    (`filter_category` = 'registration' AND `filter_value` IN ('registered', 'unregistered')) OR
    (`filter_category` = 'registry' AND `filter_value` IN ('linked', 'unlinked'))
  )
) STRICT;

CREATE UNIQUE INDEX `systems_saved_view_filters_value_unique`
  ON `systems_saved_view_filters` (`saved_view_id`, `filter_category`, `filter_value`);
CREATE INDEX `systems_saved_view_filters_view_index`
  ON `systems_saved_view_filters` (`saved_view_id`, `filter_category`);

CREATE TABLE `systems_saved_view_columns` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `saved_view_id` integer NOT NULL REFERENCES `systems_saved_views`(`id`) ON DELETE CASCADE,
  `column_key` text NOT NULL,
  `visible` integer NOT NULL,
  `display_order` integer NOT NULL,
  CONSTRAINT `systems_saved_view_columns_key_check` CHECK (`column_key` IN (
    'type', 'name', 'manufacturer', 'cpu', 'memory', 'storage', 'attention',
    'agent', 'registry', 'operatingSystem', 'uptime', 'lanIp'
  )),
  CONSTRAINT `systems_saved_view_columns_visible_check` CHECK (`visible` IN (0, 1)),
  CONSTRAINT `systems_saved_view_columns_order_check` CHECK (`display_order` >= 0)
) STRICT;

CREATE UNIQUE INDEX `systems_saved_view_columns_key_unique`
  ON `systems_saved_view_columns` (`saved_view_id`, `column_key`);
CREATE UNIQUE INDEX `systems_saved_view_columns_order_unique`
  ON `systems_saved_view_columns` (`saved_view_id`, `display_order`);

CREATE TABLE `system_attention_summaries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `host_type` text NOT NULL,
  `host_id` integer NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  `registry_count` integer NOT NULL DEFAULT 0,
  `audit_count` integer NOT NULL DEFAULT 0,
  `notification_count` integer NOT NULL DEFAULT 0,
  `total_count` integer NOT NULL DEFAULT 0,
  `input_fingerprint` text NOT NULL,
  `state` text NOT NULL,
  `revision` integer NOT NULL DEFAULT 1,
  `evaluated_at_ms` integer,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `system_attention_summaries_host_type_check` CHECK (`host_type` IN ('server', 'nas', 'pcBuild')),
  CONSTRAINT `system_attention_summaries_counts_check` CHECK (
    `registry_count` >= 0 AND `audit_count` >= 0 AND `notification_count` >= 0 AND
    `total_count` = `registry_count` + `audit_count` + `notification_count`
  ),
  CONSTRAINT `system_attention_summaries_fingerprint_check` CHECK (length(`input_fingerprint`) = 64),
  CONSTRAINT `system_attention_summaries_state_check` CHECK (`state` IN ('current', 'refreshing', 'failed')),
  CONSTRAINT `system_attention_summaries_revision_check` CHECK (`revision` > 0)
) STRICT;

CREATE UNIQUE INDEX `system_attention_summaries_host_unique`
  ON `system_attention_summaries` (`project_id`, `host_type`, `host_id`);
CREATE INDEX `system_attention_summaries_project_index`
  ON `system_attention_summaries` (`project_id`, `total_count`, `state`);

CREATE TABLE `system_attention_findings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `summary_id` integer NOT NULL REFERENCES `system_attention_summaries`(`id`) ON DELETE CASCADE,
  `category` text NOT NULL,
  `finding_key` text NOT NULL,
  `affected_item_type` text,
  `affected_item_id` integer REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  `severity` text NOT NULL,
  `title` text NOT NULL,
  `description` text NOT NULL,
  `destination_json` text NOT NULL DEFAULT '{}',
  CONSTRAINT `system_attention_findings_category_check` CHECK (`category` IN ('registry', 'audit', 'notification')),
  CONSTRAINT `system_attention_findings_affected_check` CHECK (
    (`affected_item_type` IS NULL AND `affected_item_id` IS NULL) OR
    (`affected_item_type` IS NOT NULL AND `affected_item_id` IS NOT NULL)
  ),
  CONSTRAINT `system_attention_findings_severity_check` CHECK (`severity` IN ('info', 'warning', 'error', 'critical')),
  CONSTRAINT `system_attention_findings_title_check` CHECK (length(trim(`title`)) > 0),
  CONSTRAINT `system_attention_findings_description_check` CHECK (length(trim(`description`)) > 0),
  CONSTRAINT `system_attention_findings_destination_json_check` CHECK (json_valid(`destination_json`))
) STRICT;

CREATE UNIQUE INDEX `system_attention_findings_key_unique`
  ON `system_attention_findings` (`summary_id`, `category`, `finding_key`);
CREATE INDEX `system_attention_findings_summary_index`
  ON `system_attention_findings` (`summary_id`, `category`, `severity`);

CREATE TABLE `system_attention_dirty_hosts` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `project_id` integer NOT NULL REFERENCES `projects`(`id`) ON DELETE CASCADE,
  `host_type` text NOT NULL,
  `host_id` integer NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE CASCADE,
  `reason` text NOT NULL,
  `created_at_ms` integer NOT NULL,
  CONSTRAINT `system_attention_dirty_hosts_host_type_check` CHECK (`host_type` IN ('server', 'nas', 'pcBuild')),
  CONSTRAINT `system_attention_dirty_hosts_reason_check` CHECK (length(trim(`reason`)) > 0)
) STRICT;

CREATE UNIQUE INDEX `system_attention_dirty_hosts_host_unique`
  ON `system_attention_dirty_hosts` (`project_id`, `host_type`, `host_id`);
CREATE INDEX `system_attention_dirty_hosts_created_index`
  ON `system_attention_dirty_hosts` (`created_at_ms`, `id`);

INSERT OR IGNORE INTO `system_attention_dirty_hosts` (
  `project_id`, `host_type`, `host_id`, `reason`, `created_at_ms`
)
SELECT DISTINCT
  `projects`.`id`,
  `inventory_item_types`.`key`,
  `inventory_items`.`id`,
  'migration-backfill',
  unixepoch('subsec') * 1000
FROM `projects`
JOIN `inventory_items`
JOIN `inventory_item_types`
  ON `inventory_item_types`.`id` = `inventory_items`.`type_id`
  AND `inventory_item_types`.`key` IN ('server', 'nas', 'pcBuild')
LEFT JOIN `project_inventory_memberships`
  ON `project_inventory_memberships`.`project_id` = `projects`.`id`
  AND `project_inventory_memberships`.`item_id` = `inventory_items`.`id`
WHERE `projects`.`archived_at_ms` IS NULL
  AND `inventory_items`.`archived_at_ms` IS NULL
  AND (
    `inventory_items`.`owner_project_id` = `projects`.`id`
    OR `project_inventory_memberships`.`id` IS NOT NULL
    OR (`inventory_items`.`scope` = 'global' AND `projects`.`includes_global_inventory` = 1)
  );
