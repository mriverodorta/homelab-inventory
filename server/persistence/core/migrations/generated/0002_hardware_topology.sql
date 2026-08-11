CREATE TABLE `internal_port_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`first_port_id` integer NOT NULL,
	`first_endpoint_face_id` integer,
	`second_port_id` integer NOT NULL,
	`second_endpoint_face_id` integer,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`first_port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`second_port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`first_port_id`,`first_endpoint_face_id`) REFERENCES `port_endpoint_faces`(`port_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`second_port_id`,`second_endpoint_face_id`) REFERENCES `port_endpoint_faces`(`port_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "internal_port_links_distinct_check" CHECK(
    "internal_port_links"."first_port_id" <> "internal_port_links"."second_port_id"
    OR coalesce("internal_port_links"."first_endpoint_face_id", 0) <> coalesce("internal_port_links"."second_endpoint_face_id", 0)
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `internal_port_links_first_unique` ON `internal_port_links` (`first_port_id`, (coalesce(`first_endpoint_face_id`, 0)));--> statement-breakpoint
CREATE UNIQUE INDEX `internal_port_links_second_unique` ON `internal_port_links` (`second_port_id`, (coalesce(`second_endpoint_face_id`, 0)));--> statement-breakpoint
CREATE INDEX `internal_port_links_item_index` ON `internal_port_links` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_port_details` (
	`port_id` integer PRIMARY KEY NOT NULL,
	`port_group_id` integer,
	`kind_id` integer NOT NULL,
	`connector_type_id` integer NOT NULL,
	`semantic_key` text,
	`slot_number` integer NOT NULL,
	`label` text,
	`notes` text,
	`ip_address` text,
	`role` text,
	`speed_bps` integer,
	`poe` integer,
	`origin` text DEFAULT 'fixed' NOT NULL,
	FOREIGN KEY (`port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`port_group_id`) REFERENCES `port_groups`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`kind_id`) REFERENCES `port_kinds`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`connector_type_id`) REFERENCES `connector_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "item_port_details_slot_check" CHECK("item_port_details"."slot_number" > 0),
	CONSTRAINT "item_port_details_role_check" CHECK(
    "item_port_details"."role" IS NULL OR "item_port_details"."role" IN ('access', 'trunk', 'uplink', 'management', 'disabled')
  ),
	CONSTRAINT "item_port_details_speed_check" CHECK("item_port_details"."speed_bps" IS NULL OR "item_port_details"."speed_bps" >= 0),
	CONSTRAINT "item_port_details_poe_check" CHECK("item_port_details"."poe" IS NULL OR "item_port_details"."poe" IN (0, 1)),
	CONSTRAINT "item_port_details_origin_check" CHECK("item_port_details"."origin" IN ('fixed', 'module'))
) STRICT;
--> statement-breakpoint
CREATE INDEX `item_port_details_group_index` ON `item_port_details` (`port_group_id`);--> statement-breakpoint
CREATE INDEX `item_port_details_kind_index` ON `item_port_details` (`kind_id`);--> statement-breakpoint
CREATE INDEX `item_port_details_connector_index` ON `item_port_details` (`connector_type_id`);--> statement-breakpoint
CREATE TABLE `port_endpoint_faces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`port_id` integer NOT NULL,
	`endpoint_number` integer NOT NULL,
	`side` text NOT NULL,
	FOREIGN KEY (`port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "port_endpoint_faces_number_check" CHECK("port_endpoint_faces"."endpoint_number" > 0),
	CONSTRAINT "port_endpoint_faces_side_check" CHECK("port_endpoint_faces"."side" IN ('front', 'back'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `port_endpoint_faces_port_number_unique` ON `port_endpoint_faces` (`port_id`,`endpoint_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `port_endpoint_faces_port_id_unique` ON `port_endpoint_faces` (`port_id`,`id`);--> statement-breakpoint
CREATE TABLE `port_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`item_id` integer NOT NULL,
	`semantic_key` text NOT NULL,
	`label` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "port_groups_key_check" CHECK(length(trim("port_groups"."semantic_key")) > 0),
	CONSTRAINT "port_groups_label_check" CHECK(length(trim("port_groups"."label")) > 0),
	CONSTRAINT "port_groups_sort_check" CHECK("port_groups"."sort_order" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `port_groups_item_key_unique` ON `port_groups` (`item_id`,`semantic_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `port_groups_item_sort_unique` ON `port_groups` (`item_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `boot_device_resource_form_factors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`boot_device_resource_group_id` integer NOT NULL,
	`form_factor_id` integer NOT NULL,
	FOREIGN KEY (`boot_device_resource_group_id`) REFERENCES `boot_device_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_factor_id`) REFERENCES `storage_form_factors`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `boot_device_resource_form_factors_unique` ON `boot_device_resource_form_factors` (`boot_device_resource_group_id`,`form_factor_id`);--> statement-breakpoint
CREATE INDEX `boot_device_resource_form_factors_factor_index` ON `boot_device_resource_form_factors` (`form_factor_id`);--> statement-breakpoint
CREATE TABLE `boot_device_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`controller_resource_group_id` integer,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`controller_resource_group_id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE INDEX `boot_device_resource_groups_controller_index` ON `boot_device_resource_groups` (`controller_resource_group_id`);--> statement-breakpoint
CREATE TABLE `boot_device_resource_interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`boot_device_resource_group_id` integer NOT NULL,
	`interface_id` integer NOT NULL,
	FOREIGN KEY (`boot_device_resource_group_id`) REFERENCES `boot_device_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interface_id`) REFERENCES `storage_interfaces`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `boot_device_resource_interfaces_unique` ON `boot_device_resource_interfaces` (`boot_device_resource_group_id`,`interface_id`);--> statement-breakpoint
CREATE INDEX `boot_device_resource_interfaces_interface_index` ON `boot_device_resource_interfaces` (`interface_id`);--> statement-breakpoint
CREATE TABLE `boot_device_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `compatibility_constraint_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_profile_id` integer NOT NULL,
	`semantic_key` text NOT NULL,
	`label` text NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`host_profile_id`) REFERENCES `host_compatibility_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "compatibility_constraint_groups_kind_check" CHECK("compatibility_constraint_groups"."kind" = 'mutually-exclusive')
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_constraint_groups_key_unique` ON `compatibility_constraint_groups` (`host_profile_id`,`semantic_key`);--> statement-breakpoint
CREATE TABLE `compatibility_constraint_members` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`constraint_group_id` integer NOT NULL,
	`resource_group_id` integer NOT NULL,
	FOREIGN KEY (`constraint_group_id`) REFERENCES `compatibility_constraint_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resource_group_id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_constraint_members_unique` ON `compatibility_constraint_members` (`constraint_group_id`,`resource_group_id`);--> statement-breakpoint
CREATE INDEX `compatibility_constraint_members_resource_index` ON `compatibility_constraint_members` (`resource_group_id`);--> statement-breakpoint
CREATE TABLE `controller_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`interface_family` text,
	`dedicated` integer,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "controller_resource_groups_dedicated_check" CHECK("controller_resource_groups"."dedicated" IS NULL OR "controller_resource_groups"."dedicated" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `controller_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `cooling_conditions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`condition` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `cooling_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `cooling_conditions_unique` ON `cooling_conditions` (`resource_group_id`,`condition`);--> statement-breakpoint
CREATE TABLE `cooling_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`fan_count` integer,
	`redundant` integer,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "cooling_resource_groups_fan_check" CHECK("cooling_resource_groups"."fan_count" IS NULL OR "cooling_resource_groups"."fan_count" >= 0),
	CONSTRAINT "cooling_resource_groups_redundant_check" CHECK("cooling_resource_groups"."redundant" IS NULL OR "cooling_resource_groups"."redundant" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `cpu_socket_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `expansion_accepted_heights` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`height` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `expansion_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "expansion_accepted_heights_value_check" CHECK("expansion_accepted_heights"."height" IN ('full-height', 'low-profile'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `expansion_accepted_heights_unique` ON `expansion_accepted_heights` (`resource_group_id`,`height`);--> statement-breakpoint
CREATE TABLE `expansion_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`interface_family` text NOT NULL,
	`expansion_slot_type_id` integer,
	`pcie_generation` integer,
	`mechanical_lanes` integer,
	`electrical_lanes` integer,
	`max_slot_width` integer,
	`max_power_mw` integer,
	`proprietary_riser` integer,
	`riser_capability` text,
	`riser_group` text,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expansion_slot_type_id`) REFERENCES `expansion_slot_types`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "expansion_resource_groups_family_check" CHECK(
    "expansion_resource_groups"."interface_family" IN ('pcie', 'm2-ae', 'usb', 'onboard')
  ),
	CONSTRAINT "expansion_resource_groups_generation_check" CHECK("expansion_resource_groups"."pcie_generation" IS NULL OR "expansion_resource_groups"."pcie_generation" > 0),
	CONSTRAINT "expansion_resource_groups_mechanical_check" CHECK("expansion_resource_groups"."mechanical_lanes" IS NULL OR "expansion_resource_groups"."mechanical_lanes" > 0),
	CONSTRAINT "expansion_resource_groups_electrical_check" CHECK("expansion_resource_groups"."electrical_lanes" IS NULL OR "expansion_resource_groups"."electrical_lanes" > 0),
	CONSTRAINT "expansion_resource_groups_width_check" CHECK("expansion_resource_groups"."max_slot_width" IS NULL OR "expansion_resource_groups"."max_slot_width" > 0),
	CONSTRAINT "expansion_resource_groups_power_check" CHECK("expansion_resource_groups"."max_power_mw" IS NULL OR "expansion_resource_groups"."max_power_mw" >= 0),
	CONSTRAINT "expansion_resource_groups_riser_check" CHECK("expansion_resource_groups"."proprietary_riser" IS NULL OR "expansion_resource_groups"."proprietary_riser" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE INDEX `expansion_resource_groups_slot_type_index` ON `expansion_resource_groups` (`expansion_slot_type_id`);--> statement-breakpoint
CREATE TABLE `expansion_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `host_compatibility_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_item_id` integer NOT NULL,
	`topology_completeness` text,
	`max_expansion_power_mw` integer,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_compatibility_profiles_completeness_check" CHECK(
    "host_compatibility_profiles"."topology_completeness" IS NULL
    OR "host_compatibility_profiles"."topology_completeness" IN ('complete', 'partial', 'conflicting')
  ),
	CONSTRAINT "host_compatibility_profiles_power_check" CHECK(
    "host_compatibility_profiles"."max_expansion_power_mw" IS NULL OR "host_compatibility_profiles"."max_expansion_power_mw" >= 0
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_compatibility_profiles_host_unique` ON `host_compatibility_profiles` (`host_item_id`);--> statement-breakpoint
CREATE TABLE `host_cpu_generation_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cpu_profile_id` integer NOT NULL,
	`generation` text NOT NULL,
	FOREIGN KEY (`cpu_profile_id`) REFERENCES `host_cpu_profiles`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_cpu_generation_support_unique` ON `host_cpu_generation_support` (`cpu_profile_id`,`generation`);--> statement-breakpoint
CREATE TABLE `host_cpu_population_modes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cpu_profile_id` integer NOT NULL,
	`populated_socket_count` integer NOT NULL,
	FOREIGN KEY (`cpu_profile_id`) REFERENCES `host_cpu_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_cpu_population_modes_count_check" CHECK("host_cpu_population_modes"."populated_socket_count" > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_cpu_population_modes_unique` ON `host_cpu_population_modes` (`cpu_profile_id`,`populated_socket_count`);--> statement-breakpoint
CREATE TABLE `host_cpu_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_profile_id` integer NOT NULL,
	`socket_count` integer,
	`max_tdp_mw` integer,
	FOREIGN KEY (`host_profile_id`) REFERENCES `host_compatibility_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_cpu_profiles_socket_count_check" CHECK("host_cpu_profiles"."socket_count" IS NULL OR "host_cpu_profiles"."socket_count" > 0),
	CONSTRAINT "host_cpu_profiles_tdp_check" CHECK("host_cpu_profiles"."max_tdp_mw" IS NULL OR "host_cpu_profiles"."max_tdp_mw" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_cpu_profiles_host_profile_unique` ON `host_cpu_profiles` (`host_profile_id`);--> statement-breakpoint
CREATE TABLE `host_cpu_socket_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cpu_profile_id` integer NOT NULL,
	`socket_type_id` integer NOT NULL,
	FOREIGN KEY (`cpu_profile_id`) REFERENCES `host_cpu_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`socket_type_id`) REFERENCES `cpu_socket_types`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_cpu_socket_support_unique` ON `host_cpu_socket_support` (`cpu_profile_id`,`socket_type_id`);--> statement-breakpoint
CREATE INDEX `host_cpu_socket_support_socket_index` ON `host_cpu_socket_support` (`socket_type_id`);--> statement-breakpoint
CREATE TABLE `host_memory_form_factor_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_profile_id` integer NOT NULL,
	`form_factor` text NOT NULL,
	FOREIGN KEY (`memory_profile_id`) REFERENCES `host_memory_profiles`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_memory_form_factor_support_unique` ON `host_memory_form_factor_support` (`memory_profile_id`,`form_factor`);--> statement-breakpoint
CREATE TABLE `host_memory_generation_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_profile_id` integer NOT NULL,
	`generation_id` integer NOT NULL,
	FOREIGN KEY (`memory_profile_id`) REFERENCES `host_memory_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `memory_generations`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_memory_generation_support_unique` ON `host_memory_generation_support` (`memory_profile_id`,`generation_id`);--> statement-breakpoint
CREATE INDEX `host_memory_generation_support_generation_index` ON `host_memory_generation_support` (`generation_id`);--> statement-breakpoint
CREATE TABLE `host_memory_module_type_support` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`memory_profile_id` integer NOT NULL,
	`module_type_id` integer NOT NULL,
	FOREIGN KEY (`memory_profile_id`) REFERENCES `host_memory_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`module_type_id`) REFERENCES `memory_module_types`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_memory_module_type_support_unique` ON `host_memory_module_type_support` (`memory_profile_id`,`module_type_id`);--> statement-breakpoint
CREATE INDEX `host_memory_module_type_support_type_index` ON `host_memory_module_type_support` (`module_type_id`);--> statement-breakpoint
CREATE TABLE `host_memory_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_profile_id` integer NOT NULL,
	`slot_count` integer,
	`slots_per_cpu` integer,
	`max_capacity_mib` integer,
	`max_module_capacity_mib` integer,
	`max_speed_mtps` integer,
	`ecc_support` text,
	FOREIGN KEY (`host_profile_id`) REFERENCES `host_compatibility_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_memory_profiles_slot_count_check" CHECK("host_memory_profiles"."slot_count" IS NULL OR "host_memory_profiles"."slot_count" >= 0),
	CONSTRAINT "host_memory_profiles_slots_per_cpu_check" CHECK("host_memory_profiles"."slots_per_cpu" IS NULL OR "host_memory_profiles"."slots_per_cpu" >= 0),
	CONSTRAINT "host_memory_profiles_capacity_check" CHECK("host_memory_profiles"."max_capacity_mib" IS NULL OR "host_memory_profiles"."max_capacity_mib" >= 0),
	CONSTRAINT "host_memory_profiles_module_capacity_check" CHECK(
    "host_memory_profiles"."max_module_capacity_mib" IS NULL OR "host_memory_profiles"."max_module_capacity_mib" >= 0
  ),
	CONSTRAINT "host_memory_profiles_speed_check" CHECK("host_memory_profiles"."max_speed_mtps" IS NULL OR "host_memory_profiles"."max_speed_mtps" >= 0),
	CONSTRAINT "host_memory_profiles_ecc_check" CHECK(
    "host_memory_profiles"."ecc_support" IS NULL
    OR "host_memory_profiles"."ecc_support" IN ('supported', 'unsupported', 'conditional', 'unknown')
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_memory_profiles_host_profile_unique` ON `host_memory_profiles` (`host_profile_id`);--> statement-breakpoint
CREATE TABLE `host_power_connector_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`connector` text NOT NULL,
	`count` integer NOT NULL,
	`required` integer NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_power_connector_groups_kind_check" CHECK("host_power_connector_groups"."kind" IN ('main-power', 'cpu-power')),
	CONSTRAINT "host_power_connector_groups_connector_check" CHECK(length(trim("host_power_connector_groups"."connector")) > 0),
	CONSTRAINT "host_power_connector_groups_count_check" CHECK("host_power_connector_groups"."count" > 0),
	CONSTRAINT "host_power_connector_groups_required_check" CHECK("host_power_connector_groups"."required" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `host_power_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_profile_id` integer NOT NULL,
	`configuration` text,
	`connector` text,
	`adapter_required` integer,
	`adapter_type` text,
	`redundancy` text,
	`max_graphics_power_mw` integer,
	`psu_bay_count` integer,
	`psu_type` text,
	`mixed_psu_allowed` integer,
	FOREIGN KEY (`host_profile_id`) REFERENCES `host_compatibility_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_power_profiles_adapter_required_check" CHECK("host_power_profiles"."adapter_required" IS NULL OR "host_power_profiles"."adapter_required" IN (0, 1)),
	CONSTRAINT "host_power_profiles_redundancy_check" CHECK(
    "host_power_profiles"."redundancy" IS NULL OR "host_power_profiles"."redundancy" IN ('none', 'optional', 'required', 'supported')
  ),
	CONSTRAINT "host_power_profiles_graphics_power_check" CHECK(
    "host_power_profiles"."max_graphics_power_mw" IS NULL OR "host_power_profiles"."max_graphics_power_mw" >= 0
  ),
	CONSTRAINT "host_power_profiles_psu_bay_check" CHECK("host_power_profiles"."psu_bay_count" IS NULL OR "host_power_profiles"."psu_bay_count" >= 0),
	CONSTRAINT "host_power_profiles_psu_type_check" CHECK(
    "host_power_profiles"."psu_type" IS NULL OR "host_power_profiles"."psu_type" IN ('fixed', 'cabled', 'hot-plug')
  ),
	CONSTRAINT "host_power_profiles_mixed_check" CHECK("host_power_profiles"."mixed_psu_allowed" IS NULL OR "host_power_profiles"."mixed_psu_allowed" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_power_profiles_host_profile_unique` ON `host_power_profiles` (`host_profile_id`);--> statement-breakpoint
CREATE TABLE `host_power_redundancy_modes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`power_profile_id` integer NOT NULL,
	`mode` text NOT NULL,
	FOREIGN KEY (`power_profile_id`) REFERENCES `host_power_profiles`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_power_redundancy_modes_unique` ON `host_power_redundancy_modes` (`power_profile_id`,`mode`);--> statement-breakpoint
CREATE TABLE `host_power_supported_wattages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`power_profile_id` integer NOT NULL,
	`power_mw` integer NOT NULL,
	FOREIGN KEY (`power_profile_id`) REFERENCES `host_power_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_power_supported_wattages_power_check" CHECK("host_power_supported_wattages"."power_mw" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_power_supported_wattages_unique` ON `host_power_supported_wattages` (`power_profile_id`,`power_mw`);--> statement-breakpoint
CREATE TABLE `host_resource_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_identity_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`resource_type` text NOT NULL,
	`semantic_key` text NOT NULL,
	`label` text NOT NULL,
	`slot_count` integer NOT NULL,
	`required_cpu_sockets` integer,
	`location` text,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`resource_identity_id`) REFERENCES `inventory_resources`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "host_resource_groups_type_check" CHECK("host_resource_groups"."resource_type" IN (
    'cpu', 'memory', 'storage', 'expansion', 'optionalModule', 'controllerSlot',
    'bootDeviceSlot', 'coolingProfile', 'motherboard', 'cooling', 'power',
    'case', 'psuBay', 'powerAdapter'
  )),
	CONSTRAINT "host_resource_groups_key_check" CHECK(length(trim("host_resource_groups"."semantic_key")) > 0),
	CONSTRAINT "host_resource_groups_label_check" CHECK(length(trim("host_resource_groups"."label")) > 0),
	CONSTRAINT "host_resource_groups_slot_count_check" CHECK("host_resource_groups"."slot_count" >= 0),
	CONSTRAINT "host_resource_groups_cpu_dependency_check" CHECK(
    "host_resource_groups"."required_cpu_sockets" IS NULL OR "host_resource_groups"."required_cpu_sockets" > 0
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_resource_groups_identity_unique` ON `host_resource_groups` (`resource_identity_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_resource_groups_host_key_unique` ON `host_resource_groups` (`host_item_id`,`semantic_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_resource_groups_host_id_unique` ON `host_resource_groups` (`host_item_id`,`id`);--> statement-breakpoint
CREATE INDEX `host_resource_groups_host_type_index` ON `host_resource_groups` (`host_item_id`,`resource_type`);--> statement-breakpoint
CREATE TABLE `host_resource_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`parent_slot_id` integer,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`single_capacity` integer DEFAULT true NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`host_item_id`,`resource_group_id`) REFERENCES `host_resource_groups`(`host_item_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`,`parent_slot_id`) REFERENCES `host_resource_slots`(`host_item_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "host_resource_slots_position_check" CHECK("host_resource_slots"."position" > 0),
	CONSTRAINT "host_resource_slots_label_check" CHECK(length(trim("host_resource_slots"."label")) > 0),
	CONSTRAINT "host_resource_slots_single_capacity_check" CHECK("host_resource_slots"."single_capacity" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `host_resource_slots_group_position_unique` ON `host_resource_slots` (`resource_group_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `host_resource_slots_host_id_unique` ON `host_resource_slots` (`host_item_id`,`id`);--> statement-breakpoint
CREATE INDEX `host_resource_slots_parent_index` ON `host_resource_slots` (`parent_slot_id`);--> statement-breakpoint
CREATE TABLE `management_controllers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`host_profile_id` integer NOT NULL,
	`controller_family` text,
	`controller_generation` text,
	`dedicated_port` integer,
	`shared_nic` integer,
	`port_type` text,
	`speed_bps` integer,
	FOREIGN KEY (`host_profile_id`) REFERENCES `host_compatibility_profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "management_controllers_dedicated_check" CHECK("management_controllers"."dedicated_port" IS NULL OR "management_controllers"."dedicated_port" IN (0, 1)),
	CONSTRAINT "management_controllers_shared_check" CHECK("management_controllers"."shared_nic" IS NULL OR "management_controllers"."shared_nic" IN (0, 1)),
	CONSTRAINT "management_controllers_speed_check" CHECK("management_controllers"."speed_bps" IS NULL OR "management_controllers"."speed_bps" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `management_controllers_host_profile_unique` ON `management_controllers` (`host_profile_id`);--> statement-breakpoint
CREATE TABLE `memory_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `optional_module_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `power_adapter_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `psu_bays` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `resource_accepted_kinds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "resource_accepted_kinds_value_check" CHECK(length(trim("resource_accepted_kinds"."kind")) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `resource_accepted_kinds_unique` ON `resource_accepted_kinds` (`resource_group_id`,`kind`);--> statement-breakpoint
CREATE TABLE `storage_resource_controllers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`storage_resource_group_id` integer NOT NULL,
	`controller_resource_group_id` integer NOT NULL,
	FOREIGN KEY (`storage_resource_group_id`) REFERENCES `storage_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`controller_resource_group_id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_resource_controllers_unique` ON `storage_resource_controllers` (`storage_resource_group_id`,`controller_resource_group_id`);--> statement-breakpoint
CREATE INDEX `storage_resource_controllers_controller_index` ON `storage_resource_controllers` (`controller_resource_group_id`);--> statement-breakpoint
CREATE TABLE `storage_resource_form_factors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`form_factor_id` integer NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `storage_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`form_factor_id`) REFERENCES `storage_form_factors`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_resource_form_factors_unique` ON `storage_resource_form_factors` (`resource_group_id`,`form_factor_id`);--> statement-breakpoint
CREATE INDEX `storage_resource_form_factors_factor_index` ON `storage_resource_form_factors` (`form_factor_id`);--> statement-breakpoint
CREATE TABLE `storage_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`pcie_generation` integer,
	`hot_swap` integer,
	`backplane` text,
	`direct_connect` integer,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "storage_resource_groups_pcie_check" CHECK("storage_resource_groups"."pcie_generation" IS NULL OR "storage_resource_groups"."pcie_generation" > 0),
	CONSTRAINT "storage_resource_groups_hot_swap_check" CHECK("storage_resource_groups"."hot_swap" IS NULL OR "storage_resource_groups"."hot_swap" IN (0, 1)),
	CONSTRAINT "storage_resource_groups_direct_check" CHECK("storage_resource_groups"."direct_connect" IS NULL OR "storage_resource_groups"."direct_connect" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE TABLE `storage_resource_interfaces` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`interface_id` integer NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `storage_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`interface_id`) REFERENCES `storage_interfaces`(`id`) ON UPDATE no action ON DELETE restrict
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `storage_resource_interfaces_unique` ON `storage_resource_interfaces` (`resource_group_id`,`interface_id`);--> statement-breakpoint
CREATE INDEX `storage_resource_interfaces_interface_index` ON `storage_resource_interfaces` (`interface_id`);--> statement-breakpoint
CREATE TABLE `storage_slots` (
	`id` integer PRIMARY KEY NOT NULL,
	FOREIGN KEY (`id`) REFERENCES `host_resource_slots`(`id`) ON UPDATE no action ON DELETE cascade
) STRICT;
--> statement-breakpoint
CREATE TABLE `workspace_connection_visibility` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`visible` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `workspaces`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connection_id`) REFERENCES `project_connections`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_connection_visibility_visible_check" CHECK("workspace_connection_visibility"."visible" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_connection_visibility_unique` ON `workspace_connection_visibility` (`workspace_id`,`connection_id`);--> statement-breakpoint
CREATE TABLE `workspace_manual_bend_points` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`position` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `workspaces`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connection_id`) REFERENCES `project_connections`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_manual_bend_points_position_check" CHECK("workspace_manual_bend_points"."position" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_manual_bend_points_position_unique` ON `workspace_manual_bend_points` (`workspace_id`,`connection_id`,`position`);--> statement-breakpoint
CREATE TABLE `workspace_placements` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`item_id` integer NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`orientation` text,
	`z_index` integer DEFAULT 0 NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `workspaces`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_placements_coordinate_check" CHECK(
    abs("workspace_placements"."x") <= 1000000000 AND abs("workspace_placements"."y") <= 1000000000
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_placements_workspace_item_unique` ON `workspace_placements` (`workspace_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `workspace_placements_item_index` ON `workspace_placements` (`item_id`);--> statement-breakpoint
CREATE TABLE `workspace_route_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`workspace_id` integer NOT NULL,
	`connection_id` integer NOT NULL,
	`engine_version` text NOT NULL,
	`layout_fingerprint` text NOT NULL,
	`route_fingerprint` text NOT NULL,
	`route_payload_json` text NOT NULL,
	`calculated_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`workspace_id`) REFERENCES `workspaces`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`,`connection_id`) REFERENCES `project_connections`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "workspace_route_cache_payload_check" CHECK(json_valid("workspace_route_cache"."route_payload_json"))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_route_cache_workspace_connection_unique` ON `workspace_route_cache` (`workspace_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `workspace_route_cache_layout_index` ON `workspace_route_cache` (`workspace_id`,`layout_fingerprint`);--> statement-breakpoint
CREATE TABLE `component_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`component_item_id` integer NOT NULL,
	`resource_slot_id` integer,
	`assigned_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`component_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`host_item_id`,`resource_slot_id`) REFERENCES `host_resource_slots`(`host_item_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "component_assignments_distinct_items_check" CHECK("component_assignments"."host_item_id" <> "component_assignments"."component_item_id")
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `component_assignments_project_component_unique` ON `component_assignments` (`project_id`,`component_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `component_assignments_project_slot_unique` ON `component_assignments` (`project_id`,`resource_slot_id`) WHERE "component_assignments"."resource_slot_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `component_assignments_host_index` ON `component_assignments` (`project_id`,`host_item_id`);--> statement-breakpoint
CREATE TABLE `connection_endpoints` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`connection_id` integer NOT NULL,
	`role` text NOT NULL,
	`port_id` integer NOT NULL,
	`endpoint_face_id` integer,
	FOREIGN KEY (`connection_id`) REFERENCES `project_connections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`port_id`) REFERENCES `inventory_ports`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`port_id`,`endpoint_face_id`) REFERENCES `port_endpoint_faces`(`port_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "connection_endpoints_role_check" CHECK("connection_endpoints"."role" IN ('source', 'target'))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `connection_endpoints_connection_role_unique` ON `connection_endpoints` (`connection_id`,`role`);--> statement-breakpoint
CREATE UNIQUE INDEX `connection_endpoints_port_face_unique` ON `connection_endpoints` (`port_id`, (coalesce(`endpoint_face_id`, 0)));--> statement-breakpoint
CREATE INDEX `connection_endpoints_connection_index` ON `connection_endpoints` (`connection_id`);--> statement-breakpoint
CREATE TABLE `project_connections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`connection_type` text NOT NULL,
	`negotiated_speed_bps` integer,
	`label` text,
	`source_side` text NOT NULL,
	`target_side` text NOT NULL,
	`avoid_cable_overlap` integer DEFAULT false NOT NULL,
	`created_at_ms` integer NOT NULL,
	`updated_at_ms` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_connections_type_check" CHECK("project_connections"."connection_type" IN ('network', 'display', 'power', 'other')),
	CONSTRAINT "project_connections_speed_check" CHECK("project_connections"."negotiated_speed_bps" IS NULL OR "project_connections"."negotiated_speed_bps" >= 0),
	CONSTRAINT "project_connections_source_side_check" CHECK("project_connections"."source_side" IN ('left', 'right', 'top', 'bottom')),
	CONSTRAINT "project_connections_target_side_check" CHECK("project_connections"."target_side" IN ('left', 'right', 'top', 'bottom')),
	CONSTRAINT "project_connections_overlap_check" CHECK("project_connections"."avoid_cable_overlap" IN (0, 1))
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `project_connections_project_id_unique` ON `project_connections` (`project_id`,`id`);--> statement-breakpoint
CREATE INDEX `project_connections_project_type_index` ON `project_connections` (`project_id`,`connection_type`);
--> statement-breakpoint
CREATE TRIGGER `item_port_details_group_ownership_guard`
BEFORE INSERT ON `item_port_details`
WHEN NEW.`port_group_id` IS NOT NULL AND (
	SELECT `item_id` FROM `port_groups` WHERE `id` = NEW.`port_group_id`
) <> (
	SELECT `item_id` FROM `inventory_ports` WHERE `id` = NEW.`port_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Port group must belong to the same inventory item as the port.');
END;
--> statement-breakpoint
CREATE TRIGGER `item_port_details_slot_guard`
BEFORE INSERT ON `item_port_details`
WHEN EXISTS (
	SELECT 1
	FROM `item_port_details` AS existing_details
	JOIN `inventory_ports` AS existing_port ON existing_port.`id` = existing_details.`port_id`
	JOIN `inventory_ports` AS new_port ON new_port.`id` = NEW.`port_id`
	WHERE existing_port.`item_id` = new_port.`item_id`
		AND existing_details.`slot_number` = NEW.`slot_number`
)
BEGIN
	SELECT RAISE(ABORT, 'Port slot numbers must be unique within an inventory item.');
END;
--> statement-breakpoint
CREATE TRIGGER `internal_port_links_ownership_guard`
BEFORE INSERT ON `internal_port_links`
WHEN (
	SELECT `item_id` FROM `inventory_ports` WHERE `id` = NEW.`first_port_id`
) <> NEW.`item_id` OR (
	SELECT `item_id` FROM `inventory_ports` WHERE `id` = NEW.`second_port_id`
) <> NEW.`item_id`
BEGIN
	SELECT RAISE(ABORT, 'Internal links must connect ports owned by their inventory item.');
END;
--> statement-breakpoint
CREATE TRIGGER `internal_port_links_face_guard`
BEFORE INSERT ON `internal_port_links`
WHEN NEW.`first_endpoint_face_id` IS NOT NULL
	AND NEW.`second_endpoint_face_id` IS NOT NULL
	AND (
		SELECT `side` FROM `port_endpoint_faces` WHERE `id` = NEW.`first_endpoint_face_id`
	) = (
		SELECT `side` FROM `port_endpoint_faces` WHERE `id` = NEW.`second_endpoint_face_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'Internal links must pair opposite endpoint faces.');
END;
--> statement-breakpoint
CREATE TRIGGER `connection_endpoints_kind_guard`
BEFORE INSERT ON `connection_endpoints`
WHEN (SELECT `kind_id` FROM `item_port_details` WHERE `port_id` = NEW.`port_id`) IS NULL
	OR NOT (
		(SELECT `connection_type` FROM `project_connections` WHERE `id` = NEW.`connection_id`) = 'other'
		OR (
			(SELECT `connection_type` FROM `project_connections` WHERE `id` = NEW.`connection_id`) = 'network'
			AND (SELECT `kind_id` FROM `item_port_details` WHERE `port_id` = NEW.`port_id`) IN (1, 6)
		)
		OR (
			(SELECT `connection_type` FROM `project_connections` WHERE `id` = NEW.`connection_id`) = 'display'
			AND (SELECT `kind_id` FROM `item_port_details` WHERE `port_id` = NEW.`port_id`) = 4
		)
		OR (
			(SELECT `connection_type` FROM `project_connections` WHERE `id` = NEW.`connection_id`) = 'power'
			AND (SELECT `kind_id` FROM `item_port_details` WHERE `port_id` = NEW.`port_id`) IN (2, 3)
		)
	)
BEGIN
	SELECT RAISE(ABORT, 'Connection type is incompatible with the selected port.');
END;
--> statement-breakpoint
CREATE TRIGGER `connection_endpoints_power_direction_guard`
BEFORE INSERT ON `connection_endpoints`
WHEN (SELECT `connection_type` FROM `project_connections` WHERE `id` = NEW.`connection_id`) = 'power'
	AND EXISTS (SELECT 1 FROM `connection_endpoints` WHERE `connection_id` = NEW.`connection_id`)
	AND (
		SELECT `kind_id`
		FROM `item_port_details`
		WHERE `port_id` = (
			SELECT `port_id` FROM `connection_endpoints` WHERE `connection_id` = NEW.`connection_id` LIMIT 1
		)
	) = (
		SELECT `kind_id` FROM `item_port_details` WHERE `port_id` = NEW.`port_id`
	)
BEGIN
	SELECT RAISE(ABORT, 'Power connections require one input and one output port.');
END;
