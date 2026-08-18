ALTER TABLE `optional_module_resource_groups`
ADD COLUMN `bus_evidence_state` text NOT NULL DEFAULT 'unknown'
CHECK (`bus_evidence_state` IN ('unknown', 'recorded'));
--> statement-breakpoint
UPDATE `optional_module_resource_groups`
SET `bus_evidence_state` = 'recorded'
WHERE EXISTS (
  SELECT 1 FROM `optional_module_available_buses` bus
  WHERE bus.resource_group_id = optional_module_resource_groups.id
);
--> statement-breakpoint
CREATE TABLE `network_adapter_required_buses` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL,
  `family` text NOT NULL,
  `minimum_lanes` integer,
  `minimum_pcie_generation` integer,
  `minimum_usb_generation` text,
  FOREIGN KEY (`adapter_id`) REFERENCES `network_adapters`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "network_adapter_required_buses_family_check" CHECK(`family` IN ('pcie', 'usb')),
  CONSTRAINT "network_adapter_required_buses_lanes_check" CHECK(`minimum_lanes` IS NULL OR `minimum_lanes` > 0),
  CONSTRAINT "network_adapter_required_buses_pcie_generation_check" CHECK(`minimum_pcie_generation` IS NULL OR `minimum_pcie_generation` > 0),
  CONSTRAINT "network_adapter_required_buses_shape_check" CHECK(
    (`family` = 'pcie' AND `minimum_usb_generation` IS NULL)
    OR (`family` = 'usb' AND `minimum_lanes` IS NULL AND `minimum_pcie_generation` IS NULL)
  )
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `network_adapter_required_buses_family_unique`
ON `network_adapter_required_buses` (`adapter_id`, `family`);
--> statement-breakpoint
CREATE TEMP TABLE `_v12_m2_ae_expansion_candidates` (
  `resource_group_id` integer PRIMARY KEY,
  `interface_key` text,
  `module_size` text,
  `usb_generation` text,
  `pcie_generation` integer,
  `electrical_lanes` integer
);
--> statement-breakpoint
INSERT INTO `_v12_m2_ae_expansion_candidates` (
  `resource_group_id`, `interface_key`, `module_size`, `usb_generation`,
  `pcie_generation`, `electrical_lanes`
)
SELECT group_row.id, expansion.interface_key, expansion.module_size,
       expansion.usb_generation, expansion.pcie_generation, expansion.electrical_lanes
FROM host_resource_groups group_row
JOIN expansion_resource_groups expansion ON expansion.id = group_row.id
WHERE group_row.resource_type = 'expansion'
AND expansion.interface_family = 'm2-ae'
AND (
  lower(group_row.semantic_key) IN ('wlan-m2', 'm2-ae-slot')
  OR lower(group_row.label) LIKE '%wlan%'
  OR lower(group_row.label) LIKE '%wireless%'
  OR lower(group_row.label) LIKE '%m.2%a%e%'
)
AND NOT EXISTS (
  SELECT 1 FROM host_resource_groups destination
  WHERE destination.host_item_id = group_row.host_item_id
    AND destination.id <> group_row.id
    AND lower(destination.semantic_key) IN ('wlan-m2', 'm2-ae-slot')
);
--> statement-breakpoint
DELETE FROM expansion_accepted_heights
WHERE resource_group_id IN (SELECT resource_group_id FROM `_v12_m2_ae_expansion_candidates`);
--> statement-breakpoint
DELETE FROM expansion_resource_groups
WHERE id IN (SELECT resource_group_id FROM `_v12_m2_ae_expansion_candidates`);
--> statement-breakpoint
INSERT INTO optional_module_resource_groups (id, interface_family, bus_evidence_state)
SELECT resource_group_id, 'm2-ae',
       CASE WHEN pcie_generation IS NOT NULL OR electrical_lanes IS NOT NULL OR usb_generation IS NOT NULL
         THEN 'recorded' ELSE 'unknown' END
FROM `_v12_m2_ae_expansion_candidates`;
--> statement-breakpoint
UPDATE host_resource_groups
SET resource_type = 'optionalModule', semantic_key = 'm2-ae-slot', label = 'M.2 Key E slot'
WHERE id IN (SELECT resource_group_id FROM `_v12_m2_ae_expansion_candidates`);
--> statement-breakpoint
DELETE FROM expansion_slots
WHERE id IN (
  SELECT slot.id FROM host_resource_slots slot
  JOIN `_v12_m2_ae_expansion_candidates` candidate ON candidate.resource_group_id = slot.resource_group_id
);
--> statement-breakpoint
INSERT INTO optional_module_slots (id)
SELECT slot.id FROM host_resource_slots slot
JOIN `_v12_m2_ae_expansion_candidates` candidate ON candidate.resource_group_id = slot.resource_group_id;
--> statement-breakpoint
INSERT INTO optional_module_resource_aliases (resource_group_id, alias)
SELECT resource_group_id, 'wlan-m2' FROM `_v12_m2_ae_expansion_candidates`;
--> statement-breakpoint
INSERT INTO optional_module_accepted_keys (resource_group_id, key)
SELECT resource_group_id,
       CASE WHEN upper(coalesce(interface_key, '')) = 'A' THEN 'A' ELSE 'E' END
FROM `_v12_m2_ae_expansion_candidates`;
--> statement-breakpoint
INSERT INTO optional_module_sizes (resource_group_id, module_size)
SELECT resource_group_id, module_size FROM `_v12_m2_ae_expansion_candidates`
WHERE module_size IS NOT NULL AND trim(module_size) <> '';
--> statement-breakpoint
INSERT INTO optional_module_available_buses (resource_group_id, family, lanes, pcie_generation, usb_generation)
SELECT resource_group_id, 'pcie', electrical_lanes, pcie_generation, NULL
FROM `_v12_m2_ae_expansion_candidates`
WHERE electrical_lanes IS NOT NULL OR pcie_generation IS NOT NULL;
--> statement-breakpoint
INSERT INTO optional_module_available_buses (resource_group_id, family, lanes, pcie_generation, usb_generation)
SELECT resource_group_id, 'usb', NULL, NULL, usb_generation
FROM `_v12_m2_ae_expansion_candidates`
WHERE usb_generation IS NOT NULL AND trim(usb_generation) <> '';
--> statement-breakpoint
DROP TABLE `_v12_m2_ae_expansion_candidates`;
--> statement-breakpoint
UPDATE `host_resource_groups`
SET `semantic_key` = 'm2-ae-slot',
    `label` = 'M.2 Key E slot'
WHERE `resource_type` = 'optionalModule'
AND `id` IN (
  SELECT `id` FROM `optional_module_resource_groups`
  WHERE `interface_family` = 'm2-ae'
)
AND lower(`semantic_key`) = 'wlan-m2';
--> statement-breakpoint
DELETE FROM `optional_module_resource_aliases`
WHERE `alias` = (
  SELECT `semantic_key` FROM `host_resource_groups`
  WHERE `host_resource_groups`.`id` = `optional_module_resource_aliases`.`resource_group_id`
);
--> statement-breakpoint
INSERT OR IGNORE INTO `optional_module_resource_aliases` (`resource_group_id`, `alias`)
SELECT `id`, 'wlan-m2'
FROM `optional_module_resource_groups`
WHERE `interface_family` = 'm2-ae';
--> statement-breakpoint
DELETE FROM `optional_module_accepted_keys`
WHERE `resource_group_id` IN (
  SELECT `id` FROM `optional_module_resource_groups`
  WHERE `interface_family` = 'm2-ae'
);
--> statement-breakpoint
INSERT INTO `optional_module_accepted_keys` (`resource_group_id`, `key`)
SELECT `id`, 'E'
FROM `optional_module_resource_groups`
WHERE `interface_family` = 'm2-ae';
--> statement-breakpoint
INSERT INTO `compatibility_audit_dirty_hosts` (`project_id`, `host_item_id`, `reason`, `enqueued_at_ms`)
SELECT project.id, item.id, 'catalog-contract-v12', unixepoch('subsec') * 1000
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
