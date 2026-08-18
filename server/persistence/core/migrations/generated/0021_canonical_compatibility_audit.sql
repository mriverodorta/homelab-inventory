CREATE TABLE `optional_module_resource_groups` (
	`id` integer PRIMARY KEY NOT NULL,
	`interface_family` text,
	FOREIGN KEY (`id`) REFERENCES `host_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_resource_groups_family_check" CHECK(
		`interface_family` IS NULL
		OR `interface_family` IN ('m2-ae', 'm2-bm', 'mini-pcie', 'usb', 'proprietary')
	)
) STRICT;
--> statement-breakpoint
CREATE TABLE `optional_module_resource_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`alias` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `optional_module_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_resource_aliases_value_check" CHECK(length(trim(`alias`)) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `optional_module_resource_aliases_unique`
ON `optional_module_resource_aliases` (`resource_group_id`, `alias`);
--> statement-breakpoint
CREATE TABLE `optional_module_accepted_keys` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`key` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `optional_module_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_accepted_keys_value_check" CHECK(length(trim(`key`)) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `optional_module_accepted_keys_unique`
ON `optional_module_accepted_keys` (`resource_group_id`, `key`);
--> statement-breakpoint
CREATE TABLE `optional_module_sizes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`module_size` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `optional_module_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_sizes_value_check" CHECK(length(trim(`module_size`)) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `optional_module_sizes_unique`
ON `optional_module_sizes` (`resource_group_id`, `module_size`);
--> statement-breakpoint
CREATE TABLE `optional_module_available_buses` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`family` text NOT NULL,
	`lanes` integer,
	`pcie_generation` integer,
	`usb_generation` text,
	FOREIGN KEY (`resource_group_id`) REFERENCES `optional_module_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_available_buses_family_check" CHECK(`family` IN ('pcie', 'usb')),
	CONSTRAINT "optional_module_available_buses_lanes_check" CHECK(`lanes` IS NULL OR `lanes` > 0),
	CONSTRAINT "optional_module_available_buses_pcie_check" CHECK(`pcie_generation` IS NULL OR `pcie_generation` > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `optional_module_available_buses_unique`
ON `optional_module_available_buses` (`resource_group_id`, `family`, `lanes`, `pcie_generation`, `usb_generation`);
--> statement-breakpoint
CREATE TABLE `optional_module_intended_kinds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`resource_group_id` integer NOT NULL,
	`kind` text NOT NULL,
	FOREIGN KEY (`resource_group_id`) REFERENCES `optional_module_resource_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "optional_module_intended_kinds_value_check" CHECK(length(trim(`kind`)) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `optional_module_intended_kinds_unique`
ON `optional_module_intended_kinds` (`resource_group_id`, `kind`);
--> statement-breakpoint
ALTER TABLE `compatibility_audit_findings`
ADD COLUMN `assignment_id` integer REFERENCES `component_assignments`(`id`) ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE `compatibility_audit_findings`
ADD COLUMN `resource_slot_id` integer REFERENCES `host_resource_slots`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `compatibility_audit_findings`
ADD COLUMN `classification` text NOT NULL DEFAULT 'actionable'
CHECK (`classification` IN ('actionable', 'informational'));
--> statement-breakpoint
CREATE INDEX `compatibility_audit_findings_assignment_index`
ON `compatibility_audit_findings` (`assignment_id`, `resolved_at_ms`);
--> statement-breakpoint
CREATE TABLE `compatibility_audit_dirty_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`reason` text NOT NULL,
	`enqueued_at_ms` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`) REFERENCES `inventory_items`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "compatibility_audit_dirty_hosts_reason_check" CHECK(length(trim(`reason`)) > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `compatibility_audit_dirty_hosts_unique`
ON `compatibility_audit_dirty_hosts` (`project_id`, `host_item_id`);
--> statement-breakpoint
CREATE INDEX `compatibility_audit_dirty_hosts_queue_index`
ON `compatibility_audit_dirty_hosts` (`enqueued_at_ms`, `id`);
--> statement-breakpoint
INSERT INTO `optional_module_resource_groups` (`id`, `interface_family`)
SELECT g.id,
	CASE
		WHEN lower(g.semantic_key) IN ('wlan-m2', 'm2-ae-slot')
			OR lower(g.label) LIKE '%m.2%a/e%'
			OR lower(g.label) LIKE '%m.2%wlan%'
		THEN 'm2-ae'
		ELSE NULL
	END
FROM `host_resource_groups` g
WHERE g.resource_type = 'optionalModule';
--> statement-breakpoint
INSERT OR IGNORE INTO `optional_module_resource_aliases` (`resource_group_id`, `alias`)
SELECT g.id, g.semantic_key
FROM `host_resource_groups` g
WHERE g.resource_type = 'optionalModule';
--> statement-breakpoint
INSERT OR IGNORE INTO `optional_module_accepted_keys` (`resource_group_id`, `key`)
SELECT g.id, 'A+E'
FROM `host_resource_groups` g
JOIN `optional_module_resource_groups` o ON o.id = g.id
WHERE o.interface_family = 'm2-ae';
--> statement-breakpoint
INSERT OR IGNORE INTO `optional_module_sizes` (`resource_group_id`, `module_size`)
SELECT g.id, '2230'
FROM `host_resource_groups` g
JOIN `optional_module_resource_groups` o ON o.id = g.id
WHERE o.interface_family = 'm2-ae';
--> statement-breakpoint
INSERT OR IGNORE INTO `optional_module_intended_kinds` (`resource_group_id`, `kind`)
SELECT resource_group_id, kind
FROM `resource_accepted_kinds`
WHERE resource_group_id IN (SELECT id FROM `optional_module_resource_groups`);
--> statement-breakpoint
UPDATE `host_resource_groups`
SET label = 'M.2 2230 A/E slot'
WHERE id IN (
	SELECT id FROM `optional_module_resource_groups` WHERE interface_family = 'm2-ae'
)
AND (
	lower(semantic_key) IN ('wlan-m2', 'm2-ae-slot')
	OR lower(label) LIKE '%m.2%wlan%'
);
--> statement-breakpoint
INSERT INTO `compatibility_audit_dirty_hosts` (`project_id`, `host_item_id`, `reason`, `enqueued_at_ms`)
SELECT project.id, item.id, 'schema-migration', unixepoch('subsec') * 1000
FROM `projects` project
JOIN `inventory_items` item ON item.archived_at_ms IS NULL
JOIN `inventory_item_types` item_type ON item_type.id = item.type_id
LEFT JOIN `project_inventory_memberships` membership
  ON membership.project_id = project.id AND membership.item_id = item.id
WHERE project.archived_at_ms IS NULL
AND item_type.key IN ('server', 'nas', 'pcBuild')
AND (
  item.owner_project_id = project.id
  OR membership.id IS NOT NULL
  OR (item.scope = 'global' AND project.includes_global_inventory = 1)
)
ON CONFLICT (`project_id`, `host_item_id`) DO UPDATE SET
	`reason` = excluded.`reason`,
	`enqueued_at_ms` = excluded.`enqueued_at_ms`;
