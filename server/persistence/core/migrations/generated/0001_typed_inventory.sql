CREATE TABLE `case_form_factor_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`case_id` integer NOT NULL,
	`form_factor` text NOT NULL,
	FOREIGN KEY (`case_id`) REFERENCES `computer_cases`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "case_form_factor_support_value_check" CHECK(length(trim("case_form_factor_support"."form_factor")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `case_form_factor_support_unique` ON `case_form_factor_support` (`case_id`,`form_factor`);--> statement-breakpoint
CREATE TABLE `computer_cases` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `cpu_coolers` (
	`id` integer PRIMARY KEY NOT NULL,
	`cooler_type` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cpu_coolers_type_check" CHECK("cpu_coolers"."cooler_type" IS NULL OR "cpu_coolers"."cooler_type" IN ('air', 'aio', 'custom-loop', 'passive'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `cpus` (
	`id` integer PRIMARY KEY NOT NULL,
	`core_count` integer,
	`thread_count` integer,
	`base_clock_mhz` integer,
	`boost_clock_mhz` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cpus_core_count_check" CHECK("cpus"."core_count" IS NULL OR "cpus"."core_count" > 0),
	CONSTRAINT "cpus_thread_count_check" CHECK("cpus"."thread_count" IS NULL OR "cpus"."thread_count" > 0),
	CONSTRAINT "cpus_base_clock_check" CHECK("cpus"."base_clock_mhz" IS NULL OR "cpus"."base_clock_mhz" >= 0),
	CONSTRAINT "cpus_boost_clock_check" CHECK("cpus"."boost_clock_mhz" IS NULL OR "cpus"."boost_clock_mhz" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `graphics_cards` (
	`id` integer PRIMARY KEY NOT NULL,
	`vram_mib` integer,
	`form_factor` text,
	`slot_width` text,
	`pcie` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "graphics_cards_vram_check" CHECK("graphics_cards"."vram_mib" IS NULL OR "graphics_cards"."vram_mib" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `inventory_item_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`alias` text NOT NULL,
	`normalized_alias` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_item_aliases_normalized_check" CHECK(
    "inventory_item_aliases"."normalized_alias" = lower(trim("inventory_item_aliases"."normalized_alias"))
    AND length("inventory_item_aliases"."normalized_alias") > 0
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_aliases_unique` ON `inventory_item_aliases` (`item_id`,`normalized_alias`);--> statement-breakpoint
CREATE INDEX `inventory_item_aliases_normalized_index` ON `inventory_item_aliases` (`normalized_alias`);--> statement-breakpoint
CREATE TABLE `inventory_item_properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "inventory_item_properties_key_check" CHECK(length(trim("inventory_item_properties"."key")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_item_properties_unique` ON `inventory_item_properties` (`item_id`,`key`);--> statement-breakpoint
CREATE TABLE `inventory_secondary_manufacturers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`manufacturer_id` integer,
	`manufacturer_text` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`manufacturer_id`) REFERENCES `manufacturers`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "inventory_secondary_manufacturers_value_check" CHECK(
    ("inventory_secondary_manufacturers"."manufacturer_id" IS NOT NULL AND "inventory_secondary_manufacturers"."manufacturer_text" IS NULL)
    OR ("inventory_secondary_manufacturers"."manufacturer_id" IS NULL AND length(trim("inventory_secondary_manufacturers"."manufacturer_text")) > 0)
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_secondary_manufacturers_item_unique` ON `inventory_secondary_manufacturers` (`item_id`);--> statement-breakpoint
CREATE INDEX `inventory_secondary_manufacturers_manufacturer_index` ON `inventory_secondary_manufacturers` (`manufacturer_id`);--> statement-breakpoint
CREATE TABLE `memory_modules` (
	`id` integer PRIMARY KEY NOT NULL,
	`capacity_mib` integer,
	`memory_generation_id` integer,
	`speed_mtps` integer,
	`form_factor` text,
	`module_type_id` integer,
	`ecc` integer,
	`rank` text,
	`voltage_mv` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`memory_generation_id`) REFERENCES `memory_generations`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`module_type_id`) REFERENCES `memory_module_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "memory_modules_capacity_check" CHECK("memory_modules"."capacity_mib" IS NULL OR "memory_modules"."capacity_mib" >= 0),
	CONSTRAINT "memory_modules_speed_check" CHECK("memory_modules"."speed_mtps" IS NULL OR "memory_modules"."speed_mtps" >= 0),
	CONSTRAINT "memory_modules_voltage_check" CHECK("memory_modules"."voltage_mv" IS NULL OR "memory_modules"."voltage_mv" >= 0),
	CONSTRAINT "memory_modules_ecc_check" CHECK("memory_modules"."ecc" IS NULL OR "memory_modules"."ecc" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `memory_modules_generation_index` ON `memory_modules` (`memory_generation_id`);--> statement-breakpoint
CREATE INDEX `memory_modules_module_type_index` ON `memory_modules` (`module_type_id`);--> statement-breakpoint
CREATE TABLE `motherboards` (
	`id` integer PRIMARY KEY NOT NULL,
	`chipset` text,
	`form_factor` text,
	`board_revision` text,
	`launch_date_text` text,
	`discontinued` integer,
	`wifi_generation` text,
	`bluetooth` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "motherboards_discontinued_check" CHECK("motherboards"."discontinued" IS NULL OR "motherboards"."discontinued" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `sound_cards` (
	`id` integer PRIMARY KEY NOT NULL,
	`interface` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `storage_devices` (
	`id` integer PRIMARY KEY NOT NULL,
	`capacity_bytes` integer,
	`interface_id` integer,
	`form_factor_id` integer,
	`interface_text` text,
	`form_factor_text` text,
	`partition_table` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interface_id`) REFERENCES `storage_interfaces`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`form_factor_id`) REFERENCES `storage_form_factors`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "storage_devices_capacity_check" CHECK("storage_devices"."capacity_bytes" IS NULL OR "storage_devices"."capacity_bytes" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `storage_devices_interface_index` ON `storage_devices` (`interface_id`);--> statement-breakpoint
CREATE INDEX `storage_devices_form_factor_index` ON `storage_devices` (`form_factor_id`);--> statement-breakpoint
CREATE TABLE `wireless_cards` (
	`id` integer PRIMARY KEY NOT NULL,
	`interface` text,
	`wifi_generation` text,
	`bluetooth` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "wireless_cards_bluetooth_check" CHECK("wireless_cards"."bluetooth" IS NULL OR "wireless_cards"."bluetooth" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `nas_systems` (
	`id` integer PRIMARY KEY NOT NULL,
	`drive_bay_count` integer,
	`m2_slot_count` integer,
	`power_configuration` text DEFAULT 'internal-psu' NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "nas_systems_drive_bay_count_check" CHECK("nas_systems"."drive_bay_count" IS NULL OR "nas_systems"."drive_bay_count" >= 0),
	CONSTRAINT "nas_systems_m2_slot_count_check" CHECK("nas_systems"."m2_slot_count" IS NULL OR "nas_systems"."m2_slot_count" >= 0),
	CONSTRAINT "nas_systems_power_configuration_check" CHECK("nas_systems"."power_configuration" IN ('internal-psu', 'external-adapter'))
) STRICT;
--> statement-breakpoint
CREATE TABLE `pc_builds` (
	`id` integer PRIMARY KEY NOT NULL,
	`operating_system` text,
	`usage_role` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` integer PRIMARY KEY NOT NULL,
	`hardware_class` text DEFAULT 'server' NOT NULL,
	`usage_role` text DEFAULT 'server' NOT NULL,
	`chassis_type_id` integer,
	`form_factor_text` text,
	`network_slot` text,
	`wireless` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chassis_type_id`) REFERENCES `chassis_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "servers_hardware_class_check" CHECK("servers"."hardware_class" IN ('desktop', 'workstation', 'server')),
	CONSTRAINT "servers_usage_role_check" CHECK("servers"."usage_role" IN ('server', 'desktop', 'workstation', 'other'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `servers_chassis_type_index` ON `servers` (`chassis_type_id`);--> statement-breakpoint
CREATE TABLE `monitors` (
	`id` integer PRIMARY KEY NOT NULL,
	`diagonal_mm` integer,
	`diagonal_source_text` text,
	`resolution` text,
	`refresh_rate_millihz` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "monitors_diagonal_check" CHECK("monitors"."diagonal_mm" IS NULL OR "monitors"."diagonal_mm" >= 0),
	CONSTRAINT "monitors_refresh_rate_check" CHECK("monitors"."refresh_rate_millihz" IS NULL OR "monitors"."refresh_rate_millihz" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `network_cards` (
	`id` integer PRIMARY KEY NOT NULL,
	`port_count` integer,
	`max_speed_bps` integer,
	`interface` text,
	`form_factor` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "network_cards_port_count_check" CHECK("network_cards"."port_count" IS NULL OR "network_cards"."port_count" >= 0),
	CONSTRAINT "network_cards_speed_check" CHECK("network_cards"."max_speed_bps" IS NULL OR "network_cards"."max_speed_bps" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `network_switches` (
	`id` integer PRIMARY KEY NOT NULL,
	`management_type` text,
	`switching_capacity_bps` integer,
	`fanless` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "network_switches_capacity_check" CHECK("network_switches"."switching_capacity_bps" IS NULL OR "network_switches"."switching_capacity_bps" >= 0),
	CONSTRAINT "network_switches_fanless_check" CHECK("network_switches"."fanless" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `patch_panels` (
	`id` integer PRIMARY KEY NOT NULL,
	`rack_units` integer,
	`mount` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "patch_panels_rack_units_check" CHECK("patch_panels"."rack_units" IS NULL OR "patch_panels"."rack_units" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `power_adapters` (
	`id` integer PRIMARY KEY NOT NULL,
	`rated_power_mw` integer,
	`connector_type_id` integer,
	`connector_text` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_type_id`) REFERENCES `power_connector_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "power_adapters_rated_power_check" CHECK("power_adapters"."rated_power_mw" IS NULL OR "power_adapters"."rated_power_mw" >= 0)
) STRICT;
--> statement-breakpoint
CREATE INDEX `power_adapters_connector_type_index` ON `power_adapters` (`connector_type_id`);--> statement-breakpoint
CREATE TABLE `power_strip_outlet_names` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`smart_configuration_id` integer NOT NULL,
	`port_id` integer NOT NULL,
	`name` text NOT NULL,
	FOREIGN KEY (`smart_configuration_id`) REFERENCES `power_strip_smart_configurations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "power_strip_outlet_names_name_check" CHECK(length(trim("power_strip_outlet_names"."name")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `power_strip_outlet_names_configuration_port_unique` ON `power_strip_outlet_names` (`smart_configuration_id`,`port_id`);--> statement-breakpoint
CREATE INDEX `power_strip_outlet_names_port_index` ON `power_strip_outlet_names` (`port_id`);--> statement-breakpoint
CREATE TABLE `power_strip_smart_configurations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`power_strip_id` integer NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`display_name` text,
	`management_ip` text,
	`mac_address` text,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`power_strip_id`) REFERENCES `power_strips`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "power_strip_smart_configurations_enabled_check" CHECK("power_strip_smart_configurations"."enabled" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `power_strip_smart_configurations_strip_unique` ON `power_strip_smart_configurations` (`power_strip_id`);--> statement-breakpoint
CREATE TABLE `power_strips` (
	`id` integer PRIMARY KEY NOT NULL,
	`outlet_count` integer,
	`surge_protected` integer,
	`surge_outlet_count` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "power_strips_outlet_check" CHECK("power_strips"."outlet_count" IS NULL OR "power_strips"."outlet_count" >= 0),
	CONSTRAINT "power_strips_surge_outlet_check" CHECK("power_strips"."surge_outlet_count" IS NULL OR "power_strips"."surge_outlet_count" >= 0),
	CONSTRAINT "power_strips_surge_protected_check" CHECK("power_strips"."surge_protected" IS NULL OR "power_strips"."surge_protected" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `power_supplies` (
	`id` integer PRIMARY KEY NOT NULL,
	`form_factor` text,
	`rated_power_mw` integer,
	`efficiency_rating` text,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "power_supplies_rated_power_check" CHECK("power_supplies"."rated_power_mw" IS NULL OR "power_supplies"."rated_power_mw" >= 0)
) STRICT;
--> statement-breakpoint
CREATE TABLE `power_supply_connectors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`power_supply_id` integer NOT NULL,
	`connector_type_id` integer,
	`connector_text` text,
	`count` integer NOT NULL,
	FOREIGN KEY (`power_supply_id`) REFERENCES `power_supplies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_type_id`) REFERENCES `power_connector_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "power_supply_connectors_count_check" CHECK("power_supply_connectors"."count" > 0),
	CONSTRAINT "power_supply_connectors_value_check" CHECK(
    "power_supply_connectors"."connector_type_id" IS NOT NULL OR length(trim("power_supply_connectors"."connector_text")) > 0
  )
) STRICT;
--> statement-breakpoint
CREATE INDEX `power_supply_connectors_type_index` ON `power_supply_connectors` (`connector_type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `power_supply_connectors_type_unique` ON `power_supply_connectors` (`power_supply_id`,`connector_type_id`,`connector_text`);--> statement-breakpoint
CREATE TABLE `ups_systems` (
	`id` integer PRIMARY KEY NOT NULL,
	`rated_power_mw` integer,
	`capacity_millivolt_amps` integer,
	`battery_outlet_count` integer,
	`surge_outlet_count` integer,
	`outlet_count` integer,
	FOREIGN KEY (`id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "ups_systems_rated_power_check" CHECK("ups_systems"."rated_power_mw" IS NULL OR "ups_systems"."rated_power_mw" >= 0),
	CONSTRAINT "ups_systems_capacity_check" CHECK("ups_systems"."capacity_millivolt_amps" IS NULL OR "ups_systems"."capacity_millivolt_amps" >= 0),
	CONSTRAINT "ups_systems_battery_outlet_check" CHECK("ups_systems"."battery_outlet_count" IS NULL OR "ups_systems"."battery_outlet_count" >= 0),
	CONSTRAINT "ups_systems_surge_outlet_check" CHECK("ups_systems"."surge_outlet_count" IS NULL OR "ups_systems"."surge_outlet_count" >= 0),
	CONSTRAINT "ups_systems_outlet_check" CHECK("ups_systems"."outlet_count" IS NULL OR "ups_systems"."outlet_count" >= 0)
) STRICT;
--> statement-breakpoint
ALTER TABLE `inventory_items` ADD `subtype` text;
--> statement-breakpoint
CREATE TRIGGER `servers_type_guard` BEFORE INSERT ON `servers`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 1
BEGIN SELECT RAISE(ABORT, 'Server subtype requires a server inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `nas_systems_type_guard` BEFORE INSERT ON `nas_systems`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 2
BEGIN SELECT RAISE(ABORT, 'NAS subtype requires a NAS inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `pc_builds_type_guard` BEFORE INSERT ON `pc_builds`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 3
BEGIN SELECT RAISE(ABORT, 'PC build subtype requires a PC build inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `network_switches_type_guard` BEFORE INSERT ON `network_switches`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 4
BEGIN SELECT RAISE(ABORT, 'Switch subtype requires a switch inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `patch_panels_type_guard` BEFORE INSERT ON `patch_panels`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 5
BEGIN SELECT RAISE(ABORT, 'Patch panel subtype requires a patch panel inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `monitors_type_guard` BEFORE INSERT ON `monitors`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 6
BEGIN SELECT RAISE(ABORT, 'Monitor subtype requires a monitor inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `ups_systems_type_guard` BEFORE INSERT ON `ups_systems`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 7
BEGIN SELECT RAISE(ABORT, 'UPS subtype requires a UPS inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `power_strips_type_guard` BEFORE INSERT ON `power_strips`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 8
BEGIN SELECT RAISE(ABORT, 'Power strip subtype requires a power strip inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `cpus_type_guard` BEFORE INSERT ON `cpus`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 9
BEGIN SELECT RAISE(ABORT, 'CPU subtype requires a CPU inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `memory_modules_type_guard` BEFORE INSERT ON `memory_modules`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 10
BEGIN SELECT RAISE(ABORT, 'Memory subtype requires a memory inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `storage_devices_type_guard` BEFORE INSERT ON `storage_devices`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 11
BEGIN SELECT RAISE(ABORT, 'Storage subtype requires a storage inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `graphics_cards_type_guard` BEFORE INSERT ON `graphics_cards`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 12
BEGIN SELECT RAISE(ABORT, 'Graphics subtype requires a graphics inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `network_cards_type_guard` BEFORE INSERT ON `network_cards`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 13
BEGIN SELECT RAISE(ABORT, 'Network card subtype requires a network card inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `motherboards_type_guard` BEFORE INSERT ON `motherboards`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 14
BEGIN SELECT RAISE(ABORT, 'Motherboard subtype requires a motherboard inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `cpu_coolers_type_guard` BEFORE INSERT ON `cpu_coolers`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 15
BEGIN SELECT RAISE(ABORT, 'CPU cooler subtype requires a CPU cooler inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `computer_cases_type_guard` BEFORE INSERT ON `computer_cases`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 16
BEGIN SELECT RAISE(ABORT, 'Case subtype requires a case inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `power_supplies_type_guard` BEFORE INSERT ON `power_supplies`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 17
BEGIN SELECT RAISE(ABORT, 'Power supply subtype requires a power supply inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `sound_cards_type_guard` BEFORE INSERT ON `sound_cards`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 18
BEGIN SELECT RAISE(ABORT, 'Sound card subtype requires a sound card inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `wireless_cards_type_guard` BEFORE INSERT ON `wireless_cards`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 19
BEGIN SELECT RAISE(ABORT, 'Wireless card subtype requires a wireless inventory item.'); END;
--> statement-breakpoint
CREATE TRIGGER `power_adapters_type_guard` BEFORE INSERT ON `power_adapters`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1) <> 20
BEGIN SELECT RAISE(ABORT, 'Power adapter subtype requires a power adapter inventory item.'); END;
