CREATE TABLE `inventory_identity_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`legacy_type_key` text NOT NULL,
	`legacy_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_identity_aliases_legacy_id_check" CHECK("inventory_identity_aliases"."legacy_id" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_identity_aliases_legacy_unique` ON `inventory_identity_aliases` (`legacy_type_key`,`legacy_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_identity_aliases_item_unique` ON `inventory_identity_aliases` (`item_id`);--> statement-breakpoint
CREATE TABLE `inventory_item_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_types_key_unique` ON `inventory_item_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_types_sort_order_unique` ON `inventory_item_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type_id` integer NOT NULL,
	`scope` text NOT NULL,
	`owner_project_id` integer,
	`name` text NOT NULL,
	`manufacturer_id` integer,
	`manufacturer_text` text,
	`model` text,
	`family` text,
	`product_number` text,
	`serial_number` text,
	`notes` text,
	`extensions_json` text DEFAULT '{}' NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`archived_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`type_id`) REFERENCES `inventory_item_types`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_items_scope_check" CHECK("inventory_items"."scope" IN ('global', 'project')),
	CONSTRAINT "inventory_items_scope_owner_check" CHECK(
    ("inventory_items"."scope" = 'global' AND "inventory_items"."owner_project_id" IS NULL)
    OR ("inventory_items"."scope" = 'project' AND "inventory_items"."owner_project_id" IS NOT NULL)
  ),
	CONSTRAINT "inventory_items_name_check" CHECK(length(trim("inventory_items"."name")) > 0),
	CONSTRAINT "inventory_items_row_version_check" CHECK("inventory_items"."row_version" > 0),
	CONSTRAINT "inventory_items_extensions_json_check" CHECK(json_valid("inventory_items"."extensions_json"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `inventory_items_type_index` ON `inventory_items` (`type_id`);--> statement-breakpoint
CREATE INDEX `inventory_items_owner_project_index` ON `inventory_items` (`owner_project_id`);--> statement-breakpoint
CREATE INDEX `inventory_items_manufacturer_index` ON `inventory_items` (`manufacturer_id`);--> statement-breakpoint
CREATE INDEX `inventory_items_archived_index` ON `inventory_items` (`archived_at_ms`);--> statement-breakpoint
CREATE TABLE `inventory_ports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `inventory_ports_item_index` ON `inventory_ports` (`item_id`);--> statement-breakpoint
CREATE TABLE `inventory_resources` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE INDEX `inventory_resources_item_index` ON `inventory_resources` (`item_id`);--> statement-breakpoint
CREATE TABLE `manufacturer_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`manufacturer_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "manufacturer_aliases_normalized_check" CHECK(
    "manufacturer_aliases"."normalized_alias" = lower(trim("manufacturer_aliases"."normalized_alias"))
    AND length("manufacturer_aliases"."normalized_alias") > 0
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturer_aliases_normalized_unique` ON `manufacturer_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE INDEX `manufacturer_aliases_manufacturer_index` ON `manufacturer_aliases` (`manufacturer_id`);--> statement-breakpoint
CREATE TABLE `manufacturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "manufacturers_name_check" CHECK(length(trim("manufacturers"."name")) > 0),
	CONSTRAINT "manufacturers_normalized_name_check" CHECK(
    "manufacturers"."normalized_name" = lower(trim("manufacturers"."normalized_name"))
    AND length("manufacturers"."normalized_name") > 0
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `manufacturers_normalized_name_unique` ON `manufacturers` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `port_identity_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`port_id` integer NOT NULL,
	`legacy_item_type_key` text NOT NULL,
	`legacy_item_id` integer NOT NULL,
	`legacy_port_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "port_identity_aliases_ids_check" CHECK("port_identity_aliases"."legacy_item_id" > 0 AND "port_identity_aliases"."legacy_port_id" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `port_identity_aliases_legacy_unique` ON `port_identity_aliases` (`legacy_item_type_key`,`legacy_item_id`,`legacy_port_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `port_identity_aliases_port_unique` ON `port_identity_aliases` (`port_id`);--> statement-breakpoint
CREATE TABLE `resource_identity_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_id` integer NOT NULL,
	`legacy_item_type_key` text NOT NULL,
	`legacy_item_id` integer NOT NULL,
	`legacy_resource_key` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`resource_id`) REFERENCES `inventory_resources`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "resource_identity_aliases_item_id_check" CHECK("resource_identity_aliases"."legacy_item_id" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_identity_aliases_legacy_unique` ON `resource_identity_aliases` (`legacy_item_type_key`,`legacy_item_id`,`legacy_resource_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `resource_identity_aliases_resource_unique` ON `resource_identity_aliases` (`resource_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon_key` text DEFAULT 'folder' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`includes_global_inventory` integer DEFAULT true NOT NULL,
	`archived_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "projects_name_check" CHECK(length(trim("projects"."name")) > 0),
	CONSTRAINT "projects_revision_check" CHECK("projects"."revision" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_active_name_unique` ON `projects` (lower("name")) WHERE "projects"."archived_at_ms" IS NULL;--> statement-breakpoint
CREATE TABLE `canvas_workspaces` (
	`id` integer PRIMARY KEY NOT NULL,
	`viewport_x` integer DEFAULT 0 NOT NULL,
	`viewport_y` integer DEFAULT 0 NOT NULL,
	`viewport_zoom_basis_points` integer DEFAULT 10000 NOT NULL,
	`settings_json` text DEFAULT '{}' NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "canvas_workspaces_zoom_check" CHECK("canvas_workspaces"."viewport_zoom_basis_points" > 0),
	CONSTRAINT "canvas_workspaces_settings_json_check" CHECK(json_valid("canvas_workspaces"."settings_json"))
) STRICT;
--> statement-breakpoint
CREATE TABLE `project_inventory_memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_inventory_memberships_unique` ON `project_inventory_memberships` (`project_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `project_inventory_memberships_item_index` ON `project_inventory_memberships` (`item_id`);--> statement-breakpoint
CREATE TABLE `project_inventory_overrides` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`display_name` text,
	`notes` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_inventory_overrides_content_check" CHECK(
    "project_inventory_overrides"."display_name" IS NOT NULL OR "project_inventory_overrides"."notes" IS NOT NULL
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_inventory_overrides_unique` ON `project_inventory_overrides` (`project_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `project_inventory_overrides_item_index` ON `project_inventory_overrides` (`item_id`);--> statement-breakpoint
CREATE TABLE `project_preferences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`default_workspace_id` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`default_workspace_id`) REFERENCES `workspaces`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_preferences_project_unique` ON `project_preferences` (`project_id`);--> statement-breakpoint
CREATE INDEX `project_preferences_default_workspace_index` ON `project_preferences` (`default_workspace_id`);--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`icon_key` text NOT NULL,
	`color_key` text NOT NULL,
	`sort_order` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`system_key` text,
	`archived_at_ms` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspaces_type_check" CHECK("workspaces"."type" IN ('systems', 'canvas', 'rack', 'diagram', 'vlan')),
	CONSTRAINT "workspaces_name_check" CHECK(length(trim("workspaces"."name")) > 0),
	CONSTRAINT "workspaces_sort_order_check" CHECK("workspaces"."sort_order" >= 0),
	CONSTRAINT "workspaces_revision_check" CHECK("workspaces"."revision" > 0),
	CONSTRAINT "workspaces_system_shape_check" CHECK(
    ("workspaces"."type" <> 'systems') OR (
      "workspaces"."name" = 'Systems'
      AND "workspaces"."icon_key" = 'server'
      AND "workspaces"."color_key" = 'neutral'
      AND "workspaces"."sort_order" = 0
      AND "workspaces"."system_key" = 'systems'
      AND "workspaces"."archived_at_ms" IS NULL
    )
  ),
	CONSTRAINT "workspaces_non_system_key_check" CHECK(
    ("workspaces"."type" = 'systems') OR "workspaces"."system_key" IS NULL
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_id_id_unique` ON `workspaces` (`project_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_sort_order_unique` ON `workspaces` (`project_id`,`sort_order`) WHERE "workspaces"."archived_at_ms" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workspaces_project_system_unique` ON `workspaces` (`project_id`) WHERE "workspaces"."type" = 'systems';--> statement-breakpoint
CREATE INDEX `workspaces_project_id_index` ON `workspaces` (`project_id`);--> statement-breakpoint
CREATE TABLE `application_metadata` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "application_metadata_value_json_check" CHECK(json_valid("application_metadata"."value_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `application_metadata_key_unique` ON `application_metadata` (`key`);--> statement-breakpoint
CREATE TABLE `application_settings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`value_json` text NOT NULL,
	`source` text DEFAULT 'database' NOT NULL,
	`row_version` integer DEFAULT 1 NOT NULL,
	`updated_at_ms` integer NOT NULL,
	CONSTRAINT "application_settings_source_check" CHECK("application_settings"."source" IN ('database', 'environment', 'default')),
	CONSTRAINT "application_settings_row_version_check" CHECK("application_settings"."row_version" > 0),
	CONSTRAINT "application_settings_value_json_check" CHECK(json_valid("application_settings"."value_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `application_settings_key_unique` ON `application_settings` (`key`);--> statement-breakpoint
CREATE TABLE `cross_database_operations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`operation_key` text NOT NULL,
	`operation_type` text NOT NULL,
	`state` text NOT NULL,
	`core_revision` integer,
	`telemetry_revision` integer,
	`catalog_revision` integer,
	`details_json` text DEFAULT '{}' NOT NULL,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	CONSTRAINT "cross_database_operations_state_check" CHECK("cross_database_operations"."state" IN ('pending', 'running', 'completed', 'compensating', 'failed')),
	CONSTRAINT "cross_database_operations_details_json_check" CHECK(json_valid("cross_database_operations"."details_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `cross_database_operations_key_unique` ON `cross_database_operations` (`operation_key`);--> statement-breakpoint
CREATE INDEX `cross_database_operations_state_index` ON `cross_database_operations` (`state`);--> statement-breakpoint
CREATE TABLE `migration_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`migration_key` text NOT NULL,
	`source_engine` text NOT NULL,
	`target_engine` text NOT NULL,
	`state` text NOT NULL,
	`backup_path` text,
	`source_digest` text,
	`target_digest` text,
	`error_code` text,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	CONSTRAINT "migration_runs_state_check" CHECK("migration_runs"."state" IN ('preparing', 'importing', 'verifying', 'activated', 'rolled-back', 'failed'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `migration_runs_migration_key_index` ON `migration_runs` (`migration_key`);--> statement-breakpoint
CREATE INDEX `migration_runs_state_index` ON `migration_runs` (`state`);--> statement-breakpoint
CREATE TABLE `restore_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`backup_format_version` integer NOT NULL,
	`state` text NOT NULL,
	`selected_sections_json` text NOT NULL,
	`source_digest` text,
	`error_code` text,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	CONSTRAINT "restore_runs_format_version_check" CHECK("restore_runs"."backup_format_version" > 0),
	CONSTRAINT "restore_runs_state_check" CHECK("restore_runs"."state" IN ('preparing', 'validating', 'restoring', 'verified', 'rolled-back', 'failed')),
	CONSTRAINT "restore_runs_sections_json_check" CHECK(json_valid("restore_runs"."selected_sections_json"))
) STRICT;
--> statement-breakpoint
CREATE INDEX `restore_runs_state_index` ON `restore_runs` (`state`);--> statement-breakpoint
CREATE TABLE `chassis_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "chassis_types_key_format_check" CHECK("chassis_types"."key" = lower(trim("chassis_types"."key")) AND length("chassis_types"."key") > 0),
	CONSTRAINT "chassis_types_label_check" CHECK(length(trim("chassis_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `chassis_types_key_unique` ON `chassis_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `chassis_types_sort_order_unique` ON `chassis_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `connector_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "connector_types_key_format_check" CHECK("connector_types"."key" = lower(trim("connector_types"."key")) AND length("connector_types"."key") > 0),
	CONSTRAINT "connector_types_label_check" CHECK(length(trim("connector_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `connector_types_key_unique` ON `connector_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `connector_types_sort_order_unique` ON `connector_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `cpu_socket_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "cpu_socket_types_key_format_check" CHECK("cpu_socket_types"."key" = lower(trim("cpu_socket_types"."key")) AND length("cpu_socket_types"."key") > 0),
	CONSTRAINT "cpu_socket_types_label_check" CHECK(length(trim("cpu_socket_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `cpu_socket_types_key_unique` ON `cpu_socket_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `cpu_socket_types_sort_order_unique` ON `cpu_socket_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `expansion_slot_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "expansion_slot_types_key_format_check" CHECK("expansion_slot_types"."key" = lower(trim("expansion_slot_types"."key")) AND length("expansion_slot_types"."key") > 0),
	CONSTRAINT "expansion_slot_types_label_check" CHECK(length(trim("expansion_slot_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `expansion_slot_types_key_unique` ON `expansion_slot_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `expansion_slot_types_sort_order_unique` ON `expansion_slot_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `memory_generations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "memory_generations_key_format_check" CHECK("memory_generations"."key" = lower(trim("memory_generations"."key")) AND length("memory_generations"."key") > 0),
	CONSTRAINT "memory_generations_label_check" CHECK(length(trim("memory_generations"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_generations_key_unique` ON `memory_generations` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_generations_sort_order_unique` ON `memory_generations` (`sort_order`);--> statement-breakpoint
CREATE TABLE `memory_module_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "memory_module_types_key_format_check" CHECK("memory_module_types"."key" = lower(trim("memory_module_types"."key")) AND length("memory_module_types"."key") > 0),
	CONSTRAINT "memory_module_types_label_check" CHECK(length(trim("memory_module_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `memory_module_types_key_unique` ON `memory_module_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `memory_module_types_sort_order_unique` ON `memory_module_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `port_kinds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "port_kinds_key_format_check" CHECK("port_kinds"."key" = lower(trim("port_kinds"."key")) AND length("port_kinds"."key") > 0),
	CONSTRAINT "port_kinds_label_check" CHECK(length(trim("port_kinds"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `port_kinds_key_unique` ON `port_kinds` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `port_kinds_sort_order_unique` ON `port_kinds` (`sort_order`);--> statement-breakpoint
CREATE TABLE `power_connector_types` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "power_connector_types_key_format_check" CHECK("power_connector_types"."key" = lower(trim("power_connector_types"."key")) AND length("power_connector_types"."key") > 0),
	CONSTRAINT "power_connector_types_label_check" CHECK(length(trim("power_connector_types"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `power_connector_types_key_unique` ON `power_connector_types` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `power_connector_types_sort_order_unique` ON `power_connector_types` (`sort_order`);--> statement-breakpoint
CREATE TABLE `storage_form_factors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "storage_form_factors_key_format_check" CHECK("storage_form_factors"."key" = lower(trim("storage_form_factors"."key")) AND length("storage_form_factors"."key") > 0),
	CONSTRAINT "storage_form_factors_label_check" CHECK(length(trim("storage_form_factors"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_form_factors_key_unique` ON `storage_form_factors` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_form_factors_sort_order_unique` ON `storage_form_factors` (`sort_order`);--> statement-breakpoint
CREATE TABLE `storage_interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	CONSTRAINT "storage_interfaces_key_format_check" CHECK("storage_interfaces"."key" = lower(trim("storage_interfaces"."key")) AND length("storage_interfaces"."key") > 0),
	CONSTRAINT "storage_interfaces_label_check" CHECK(length(trim("storage_interfaces"."label")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_interfaces_key_unique` ON `storage_interfaces` (`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `storage_interfaces_sort_order_unique` ON `storage_interfaces` (`sort_order`);
--> statement-breakpoint
INSERT INTO `inventory_item_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'server', 'Server', 1),
	(2, 'nas', 'NAS', 2),
	(3, 'pcBuild', 'PC Build', 3),
	(4, 'switch', 'Switch', 4),
	(5, 'patchPanel', 'Patch Panel', 5),
	(6, 'monitor', 'Monitor', 6),
	(7, 'ups', 'UPS', 7),
	(8, 'powerStrip', 'Power Strip', 8),
	(9, 'cpu', 'CPU', 9),
	(10, 'ram', 'Memory', 10),
	(11, 'storage', 'Storage', 11),
	(12, 'gpu', 'Video Card', 12),
	(13, 'network', 'Network Card', 13),
	(14, 'motherboard', 'Motherboard', 14),
	(15, 'cpuCooler', 'CPU Cooler', 15),
	(16, 'case', 'Case', 16),
	(17, 'powerSupply', 'Power Supply', 17),
	(18, 'soundCard', 'Sound Card', 18),
	(19, 'wireless', 'Wireless Card', 19),
	(20, 'powerAdapter', 'Power Adapter', 20);
--> statement-breakpoint
INSERT INTO `cpu_socket_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'lga1151', 'LGA1151', 1),
	(2, 'lga1200', 'LGA1200', 2),
	(3, 'lga1700', 'LGA1700', 3),
	(4, 'lga1851', 'LGA1851', 4),
	(5, 'am4', 'AM4', 5),
	(6, 'am5', 'AM5', 6),
	(7, 'sp3', 'SP3', 7),
	(8, 'sp5', 'SP5', 8),
	(9, 'str5', 'sTR5', 9),
	(10, 'bga', 'BGA', 10);
--> statement-breakpoint
INSERT INTO `memory_generations` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'ddr3', 'DDR3', 1),
	(2, 'ddr4', 'DDR4', 2),
	(3, 'ddr5', 'DDR5', 3),
	(4, 'lpddr4', 'LPDDR4', 4),
	(5, 'lpddr5', 'LPDDR5', 5);
--> statement-breakpoint
INSERT INTO `memory_module_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'dimm', 'DIMM', 1),
	(2, 'sodimm', 'SO-DIMM', 2),
	(3, 'udimm', 'UDIMM', 3),
	(4, 'rdimm', 'RDIMM', 4),
	(5, 'lrdimm', 'LRDIMM', 5),
	(6, 'ecc-udimm', 'ECC UDIMM', 6);
--> statement-breakpoint
INSERT INTO `storage_interfaces` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'sata', 'SATA', 1),
	(2, 'sas', 'SAS', 2),
	(3, 'nvme', 'NVMe', 3),
	(4, 'pcie', 'PCIe', 4),
	(5, 'usb', 'USB', 5),
	(6, 'ide', 'IDE', 6);
--> statement-breakpoint
INSERT INTO `storage_form_factors` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, '2.5-inch', '2.5 inch', 1),
	(2, '3.5-inch', '3.5 inch', 2),
	(3, 'm2-2230', 'M.2 2230', 3),
	(4, 'm2-2242', 'M.2 2242', 4),
	(5, 'm2-2260', 'M.2 2260', 5),
	(6, 'm2-2280', 'M.2 2280', 6),
	(7, 'm2-22110', 'M.2 22110', 7),
	(8, 'u2', 'U.2', 8),
	(9, 'msata', 'mSATA', 9);
--> statement-breakpoint
INSERT INTO `expansion_slot_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'pcie-x1', 'PCIe x1', 1),
	(2, 'pcie-x4', 'PCIe x4', 2),
	(3, 'pcie-x8', 'PCIe x8', 3),
	(4, 'pcie-x16', 'PCIe x16', 4),
	(5, 'mini-pcie', 'Mini PCIe', 5),
	(6, 'm2-ae', 'M.2 A/E key', 6),
	(7, 'm2-b', 'M.2 B key', 7),
	(8, 'm2-m', 'M.2 M key', 8);
--> statement-breakpoint
INSERT INTO `port_kinds` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'network', 'Network', 1),
	(2, 'power-input', 'Power input', 2),
	(3, 'power-output', 'Power output', 3),
	(4, 'video', 'Video', 4),
	(5, 'data', 'Data', 5),
	(6, 'management', 'Management', 6),
	(7, 'audio', 'Audio', 7);
--> statement-breakpoint
INSERT INTO `connector_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'rj45', 'RJ45', 1),
	(2, 'sfp', 'SFP', 2),
	(3, 'sfp-plus', 'SFP+', 3),
	(4, 'sfp28', 'SFP28', 4),
	(5, 'qsfp-plus', 'QSFP+', 5),
	(6, 'displayport', 'DisplayPort', 6),
	(7, 'hdmi', 'HDMI', 7),
	(8, 'usb-a', 'USB-A', 8),
	(9, 'usb-c', 'USB-C', 9),
	(10, 'iec-c13', 'IEC C13', 10),
	(11, 'iec-c14', 'IEC C14', 11),
	(12, 'slim-tip', 'Slim tip', 12);
--> statement-breakpoint
INSERT INTO `chassis_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'micro', 'Micro', 1),
	(2, 'mini', 'Mini', 2),
	(3, 'tiny', 'Tiny', 3),
	(4, 'compact', 'Compact', 4),
	(5, 'sff', 'Small Form Factor', 5),
	(6, 'tower', 'Tower', 6),
	(7, 'rack', 'Rack', 7),
	(8, 'rack-workstation', 'Rack Workstation', 8),
	(9, 'microserver', 'MicroServer', 9),
	(10, 'tower-server', 'Tower Server', 10),
	(11, 'rack-server', 'Rack Server', 11);
--> statement-breakpoint
INSERT INTO `power_connector_types` (`id`, `key`, `label`, `sort_order`) VALUES
	(1, 'iec-c13', 'IEC C13', 1),
	(2, 'iec-c14', 'IEC C14', 2),
	(3, 'nema-5-15p', 'NEMA 5-15P', 3),
	(4, 'nema-5-15r', 'NEMA 5-15R', 4),
	(5, 'slim-tip', 'Slim tip', 5),
	(6, 'barrel', 'Barrel', 6),
	(7, 'usb-c-pd', 'USB-C Power Delivery', 7),
	(8, 'proprietary', 'Proprietary', 8);
--> statement-breakpoint
INSERT INTO `projects` (
	`id`, `name`, `description`, `icon_key`, `revision`, `includes_global_inventory`,
	`created_at_ms`, `updated_at_ms`
) VALUES (1, 'Default Project', NULL, 'folder', 1, 1, 0, 0);
--> statement-breakpoint
INSERT INTO `workspaces` (
	`id`, `project_id`, `type`, `name`, `icon_key`, `color_key`, `sort_order`,
	`revision`, `system_key`, `created_at_ms`, `updated_at_ms`
) VALUES
	(1, 1, 'systems', 'Systems', 'server', 'neutral', 0, 1, 'systems', 0, 0),
	(2, 1, 'canvas', 'Canvas', 'network', 'blue', 1, 1, NULL, 0, 0);
--> statement-breakpoint
INSERT INTO `canvas_workspaces` (`id`, `viewport_x`, `viewport_y`, `viewport_zoom_basis_points`, `settings_json`)
VALUES (2, 0, 0, 10000, '{}');
--> statement-breakpoint
INSERT INTO `project_preferences` (`id`, `project_id`, `default_workspace_id`, `updated_at_ms`)
VALUES (1, 1, 2, 0);
--> statement-breakpoint
CREATE TRIGGER `inventory_identity_aliases_immutable_update`
BEFORE UPDATE ON `inventory_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Inventory identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `inventory_identity_aliases_immutable_delete`
BEFORE DELETE ON `inventory_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Inventory identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `port_identity_aliases_immutable_update`
BEFORE UPDATE ON `port_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Port identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `port_identity_aliases_immutable_delete`
BEFORE DELETE ON `port_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Port identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `resource_identity_aliases_immutable_update`
BEFORE UPDATE ON `resource_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Resource identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `resource_identity_aliases_immutable_delete`
BEFORE DELETE ON `resource_identity_aliases`
BEGIN
	SELECT RAISE(ABORT, 'Resource identity aliases are immutable.');
END;
--> statement-breakpoint
CREATE TRIGGER `systems_workspace_delete_guard`
BEFORE DELETE ON `workspaces`
WHEN OLD.`type` = 'systems'
BEGIN
	SELECT RAISE(ABORT, 'The Systems workspace cannot be deleted.');
END;
--> statement-breakpoint
CREATE TRIGGER `last_canvas_workspace_delete_guard`
BEFORE DELETE ON `workspaces`
WHEN OLD.`type` = 'canvas'
	AND OLD.`archived_at_ms` IS NULL
	AND (SELECT COUNT(*) FROM `workspaces` WHERE `project_id` = OLD.`project_id` AND `type` = 'canvas' AND `archived_at_ms` IS NULL) = 1
BEGIN
	SELECT RAISE(ABORT, 'A project must retain at least one Canvas workspace.');
END;
--> statement-breakpoint
CREATE TRIGGER `last_canvas_workspace_archive_guard`
BEFORE UPDATE OF `archived_at_ms` ON `workspaces`
WHEN OLD.`type` = 'canvas'
	AND OLD.`archived_at_ms` IS NULL
	AND NEW.`archived_at_ms` IS NOT NULL
	AND (SELECT COUNT(*) FROM `workspaces` WHERE `project_id` = OLD.`project_id` AND `type` = 'canvas' AND `archived_at_ms` IS NULL) = 1
BEGIN
	SELECT RAISE(ABORT, 'A project must retain at least one Canvas workspace.');
END;
