ALTER TABLE `nas_systems` ADD `form_factor_text` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `platform_family` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `variant_key` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `hardware_revision` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `board_revision` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `release_date_text` text;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `discontinued` integer;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `width_mm` integer;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `height_mm` integer;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `depth_mm` integer;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `mass_grams` integer;
--> statement-breakpoint
ALTER TABLE `nas_systems` ADD `rack_units` integer;
--> statement-breakpoint
ALTER TABLE `host_memory_profiles` ADD `oem_max_capacity_mib` integer;
--> statement-breakpoint
ALTER TABLE `host_memory_profiles` ADD `oem_max_module_capacity_mib` integer;
--> statement-breakpoint
ALTER TABLE `host_memory_profiles` ADD `verified_max_capacity_mib` integer;
--> statement-breakpoint
ALTER TABLE `host_memory_profiles` ADD `verified_max_module_capacity_mib` integer;
--> statement-breakpoint
ALTER TABLE `host_power_profiles` ADD `adapter_disposition` text;
--> statement-breakpoint
INSERT INTO `memory_module_types` (`key`, `label`, `sort_order`)
SELECT 'onboard', 'Onboard', coalesce(max(`sort_order`), 0) + 1
FROM `memory_module_types`
WHERE NOT EXISTS (
	SELECT 1 FROM `memory_module_types` WHERE `key` = 'onboard'
);
--> statement-breakpoint
UPDATE `host_power_profiles`
SET `adapter_disposition` = 'replaceable'
WHERE `configuration` = 'external-adapter' AND `adapter_disposition` IS NULL;
--> statement-breakpoint
CREATE TABLE `host_fixed_components` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`catalog_component_id` integer NOT NULL,
	`component_type` text NOT NULL,
	`disposition` text NOT NULL,
	`label` text NOT NULL,
	`template_key` text,
	`template_revision` integer,
	`item_json` text NOT NULL,
	`extensions_json` text DEFAULT '{}' NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT `host_fixed_components_catalog_id_check` CHECK(`catalog_component_id` > 0),
	CONSTRAINT `host_fixed_components_type_check` CHECK(length(trim(`component_type`)) > 0),
	CONSTRAINT `host_fixed_components_disposition_check` CHECK(`disposition` IN ('fixed', 'soldered')),
	CONSTRAINT `host_fixed_components_label_check` CHECK(length(trim(`label`)) > 0),
	CONSTRAINT `host_fixed_components_template_revision_check` CHECK(
		`template_revision` IS NULL
		OR (`template_revision` > 0 AND `template_key` IS NOT NULL AND length(trim(`template_key`)) > 0)
	),
	CONSTRAINT `host_fixed_components_item_json_check` CHECK(json_valid(`item_json`) AND json_type(`item_json`) = 'object'),
	CONSTRAINT `host_fixed_components_extensions_json_check` CHECK(json_valid(`extensions_json`) AND json_type(`extensions_json`) = 'object')
) STRICT;
--> statement-breakpoint
CREATE INDEX `host_fixed_components_host_type_index`
ON `host_fixed_components` (`host_item_id`, `component_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `host_fixed_components_host_catalog_id_unique`
ON `host_fixed_components` (`host_item_id`, `catalog_component_id`);
