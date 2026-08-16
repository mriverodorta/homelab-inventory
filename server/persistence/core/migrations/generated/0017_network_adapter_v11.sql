CREATE TEMP TABLE `network_v11_expansion_heights` (
  `id` integer PRIMARY KEY NOT NULL,
  `resource_group_id` integer NOT NULL,
  `height` text NOT NULL
) STRICT;

INSERT INTO `network_v11_expansion_heights` (`id`, `resource_group_id`, `height`)
SELECT `id`, `resource_group_id`, `height` FROM `expansion_accepted_heights`;

DROP TABLE `expansion_accepted_heights`;

CREATE TABLE `network_v11_expansion_resource_groups` (
  `id` integer PRIMARY KEY NOT NULL REFERENCES `host_resource_groups`(`id`) ON DELETE cascade,
  `interface_family` text NOT NULL CHECK (`interface_family` IN (
    'pcie', 'm2-ae', 'm2-bm', 'mini-pcie', 'usb', 'ocp', 'mezzanine', 'onboard', 'proprietary'
  )),
  `interface_key` text,
  `keying` text,
  `module_size` text,
  `usb_generation` text,
  `connector` text,
  `ocp_version` text,
  `expansion_slot_type_id` integer REFERENCES `expansion_slot_types`(`id`) ON DELETE restrict,
  `pcie_generation` integer CHECK (`pcie_generation` IS NULL OR `pcie_generation` > 0),
  `mechanical_lanes` integer CHECK (`mechanical_lanes` IS NULL OR `mechanical_lanes` > 0),
  `electrical_lanes` integer CHECK (`electrical_lanes` IS NULL OR `electrical_lanes` > 0),
  `max_slot_width` integer CHECK (`max_slot_width` IS NULL OR `max_slot_width` > 0),
  `max_power_mw` integer CHECK (`max_power_mw` IS NULL OR `max_power_mw` >= 0),
  `proprietary_riser` integer CHECK (`proprietary_riser` IS NULL OR `proprietary_riser` IN (0, 1)),
  `riser_capability` text,
  `riser_group` text
) STRICT;

INSERT INTO `network_v11_expansion_resource_groups` (
  `id`, `interface_family`, `expansion_slot_type_id`, `pcie_generation`, `mechanical_lanes`,
  `electrical_lanes`, `max_slot_width`, `max_power_mw`, `proprietary_riser`,
  `riser_capability`, `riser_group`
)
SELECT
  `id`, `interface_family`, `expansion_slot_type_id`, `pcie_generation`, `mechanical_lanes`,
  `electrical_lanes`, `max_slot_width`, `max_power_mw`, `proprietary_riser`,
  `riser_capability`, `riser_group`
FROM `expansion_resource_groups`;

DROP TABLE `expansion_resource_groups`;
ALTER TABLE `network_v11_expansion_resource_groups` RENAME TO `expansion_resource_groups`;
CREATE INDEX `expansion_resource_groups_slot_type_index`
  ON `expansion_resource_groups` (`expansion_slot_type_id`);

CREATE TABLE `expansion_accepted_heights` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `resource_group_id` integer NOT NULL REFERENCES `expansion_resource_groups`(`id`) ON DELETE cascade,
  `height` text NOT NULL CHECK (`height` IN ('full-height', 'low-profile'))
) STRICT;

INSERT INTO `expansion_accepted_heights` (`id`, `resource_group_id`, `height`)
SELECT `id`, `resource_group_id`, `height` FROM `network_v11_expansion_heights`;

CREATE UNIQUE INDEX `expansion_accepted_heights_unique`
  ON `expansion_accepted_heights` (`resource_group_id`, `height`);

DROP TABLE `network_v11_expansion_heights`;

CREATE TABLE `network_adapters` (
  `id` integer PRIMARY KEY NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE cascade,
  `network_technology` text NOT NULL CHECK (`network_technology` IN ('ethernet', 'wifi', 'fibre-channel', 'infiniband', 'converged', 'cellular', 'other')),
  `controller` text,
  `form_factor` text NOT NULL CHECK (length(trim(`form_factor`)) > 0),
  `card_height` text CHECK (`card_height` IS NULL OR `card_height` IN ('full-height', 'low-profile')),
  `slot_width` integer CHECK (`slot_width` IS NULL OR `slot_width` > 0),
  `power_mw` integer CHECK (`power_mw` IS NULL OR `power_mw` >= 0),
  `max_speed_bps` integer CHECK (`max_speed_bps` IS NULL OR `max_speed_bps` > 0),
  `max_phy_rate_bps` integer CHECK (`max_phy_rate_bps` IS NULL OR `max_phy_rate_bps` > 0),
  `spatial_streams` integer CHECK (`spatial_streams` IS NULL OR `spatial_streams` > 0),
  `bluetooth_version` text,
  `antenna_topology` text,
  `hardware_revision` text,
  `discontinued` integer CHECK (`discontinued` IS NULL OR `discontinued` IN (0, 1)),
  CHECK (`network_technology` NOT IN ('wifi', 'cellular') OR `max_speed_bps` IS NULL)
) STRICT;

CREATE TABLE `network_adapter_host_interfaces` (
  `adapter_id` integer PRIMARY KEY NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `family` text NOT NULL CHECK (`family` IN ('pcie', 'm2-ae', 'm2-bm', 'mini-pcie', 'usb', 'ocp', 'mezzanine', 'onboard', 'proprietary')),
  `pcie_generation` integer CHECK (`pcie_generation` IS NULL OR `pcie_generation` > 0),
  `connector_lanes` integer CHECK (`connector_lanes` IS NULL OR `connector_lanes` > 0),
  `minimum_electrical_lanes` integer CHECK (`minimum_electrical_lanes` IS NULL OR `minimum_electrical_lanes` > 0),
  `key` text,
  `module_size` text,
  `usb_generation` text,
  `connector` text,
  `ocp_version` text,
  `interface_key` text,
  CHECK (`connector_lanes` IS NULL OR `minimum_electrical_lanes` IS NULL OR `minimum_electrical_lanes` <= `connector_lanes`)
) STRICT;

CREATE TABLE `network_adapter_operating_modes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `mode` text NOT NULL CHECK (length(trim(`mode`)) > 0),
  UNIQUE (`adapter_id`, `mode`)
) STRICT;

CREATE TABLE `network_adapter_wifi_generations` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `generation` text NOT NULL CHECK (length(trim(`generation`)) > 0),
  UNIQUE (`adapter_id`, `generation`)
) STRICT;

CREATE TABLE `network_adapter_frequency_bands` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `frequency_mhz` integer NOT NULL CHECK (`frequency_mhz` > 0),
  UNIQUE (`adapter_id`, `frequency_mhz`)
) STRICT;

CREATE TABLE `network_adapter_capabilities` (
  `adapter_id` integer PRIMARY KEY NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `sriov` integer CHECK (`sriov` IS NULL OR `sriov` IN (0, 1)),
  `ptp` integer CHECK (`ptp` IS NULL OR `ptp` IN (0, 1)),
  `pxe` integer CHECK (`pxe` IS NULL OR `pxe` IN (0, 1)),
  `uefi_boot` integer CHECK (`uefi_boot` IS NULL OR `uefi_boot` IN (0, 1)),
  `wake_on_lan` integer CHECK (`wake_on_lan` IS NULL OR `wake_on_lan` IN (0, 1))
) STRICT;

CREATE TABLE `network_adapter_rdma_modes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `mode` text NOT NULL CHECK (length(trim(`mode`)) > 0),
  UNIQUE (`adapter_id`, `mode`)
) STRICT;

CREATE TABLE `network_adapter_offloads` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `offload` text NOT NULL CHECK (length(trim(`offload`)) > 0),
  UNIQUE (`adapter_id`, `offload`)
) STRICT;

CREATE TABLE `network_adapter_ports` (
  `port_id` integer PRIMARY KEY NOT NULL REFERENCES `inventory_ports`(`id`) ON DELETE cascade,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `network_technology` text NOT NULL CHECK (`network_technology` IN ('ethernet', 'fibre-channel', 'infiniband', 'converged', 'other')),
  `vendor_lock` integer CHECK (`vendor_lock` IS NULL OR `vendor_lock` IN (0, 1))
) STRICT;

CREATE INDEX `network_adapter_ports_adapter_index` ON `network_adapter_ports` (`adapter_id`);

CREATE TABLE `network_adapter_port_supported_speeds` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `port_id` integer NOT NULL REFERENCES `network_adapter_ports`(`port_id`) ON DELETE cascade,
  `speed_bps` integer NOT NULL CHECK (`speed_bps` > 0),
  UNIQUE (`port_id`, `speed_bps`)
) STRICT;

CREATE TABLE `network_adapter_port_operating_modes` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `port_id` integer NOT NULL REFERENCES `network_adapter_ports`(`port_id`) ON DELETE cascade,
  `mode` text NOT NULL CHECK (length(trim(`mode`)) > 0),
  UNIQUE (`port_id`, `mode`)
) STRICT;

CREATE TABLE `network_adapter_port_media` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `port_id` integer NOT NULL REFERENCES `network_adapter_ports`(`port_id`) ON DELETE cascade,
  `medium` text NOT NULL CHECK (`medium` IN ('dac', 'aoc', 'optical-transceiver', 'copper-transceiver', 'active-copper', 'passive-copper')),
  UNIQUE (`port_id`, `medium`)
) STRICT;

CREATE TABLE `network_port_local_overrides` (
  `port_id` integer PRIMARY KEY NOT NULL REFERENCES `network_adapter_ports`(`port_id`) ON DELETE cascade,
  `label` text,
  `ip_address` text,
  `mac_address` text,
  `role` text CHECK (`role` IS NULL OR `role` IN ('access', 'trunk', 'uplink', 'management', 'disabled')),
  `admin_state` text CHECK (`admin_state` IS NULL OR `admin_state` IN ('enabled', 'disabled')),
  `updated_at_ms` integer NOT NULL
) STRICT;

CREATE TABLE `network_adapter_extension_values` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `adapter_id` integer NOT NULL REFERENCES `network_adapters`(`id`) ON DELETE cascade,
  `field_path` text NOT NULL CHECK (length(trim(`field_path`)) > 0),
  `value_type` text NOT NULL CHECK (`value_type` IN ('text', 'integer', 'real', 'boolean', 'null', 'object', 'array')),
  `text_value` text,
  `integer_value` integer,
  `real_value` real,
  `boolean_value` integer CHECK (`boolean_value` IS NULL OR `boolean_value` IN (0, 1)),
  `null_value` integer CHECK (`null_value` IS NULL OR `null_value` = 1),
  UNIQUE (`adapter_id`, `field_path`),
  CHECK (
    (`value_type` = 'text' AND `text_value` IS NOT NULL AND `integer_value` IS NULL AND `real_value` IS NULL AND `boolean_value` IS NULL AND `null_value` IS NULL)
    OR (`value_type` = 'integer' AND `text_value` IS NULL AND `integer_value` IS NOT NULL AND `real_value` IS NULL AND `boolean_value` IS NULL AND `null_value` IS NULL)
    OR (`value_type` = 'real' AND `text_value` IS NULL AND `integer_value` IS NULL AND `real_value` IS NOT NULL AND `boolean_value` IS NULL AND `null_value` IS NULL)
    OR (`value_type` = 'boolean' AND `text_value` IS NULL AND `integer_value` IS NULL AND `real_value` IS NULL AND `boolean_value` IS NOT NULL AND `null_value` IS NULL)
    OR (`value_type` = 'null' AND `text_value` IS NULL AND `integer_value` IS NULL AND `real_value` IS NULL AND `boolean_value` IS NULL AND `null_value` = 1)
    OR (`value_type` IN ('object', 'array') AND `text_value` IS NULL AND `integer_value` IS NULL AND `real_value` IS NULL AND `boolean_value` IS NULL AND `null_value` IS NULL)
  )
) STRICT;

CREATE TABLE `inventory_compatibility_aliases` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `item_id` integer NOT NULL REFERENCES `inventory_items`(`id`) ON DELETE cascade,
  `legacy_type_key` text NOT NULL,
  `legacy_id` integer NOT NULL CHECK (`legacy_id` > 0),
  `created_at_ms` integer NOT NULL,
  UNIQUE (`legacy_type_key`, `legacy_id`)
) STRICT;

CREATE INDEX `inventory_compatibility_aliases_item_index`
  ON `inventory_compatibility_aliases` (`item_id`);

CREATE TABLE `port_compatibility_aliases` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `port_id` integer NOT NULL REFERENCES `inventory_ports`(`id`) ON DELETE cascade,
  `legacy_item_type_key` text NOT NULL,
  `legacy_item_id` integer NOT NULL CHECK (`legacy_item_id` > 0),
  `legacy_port_id` integer NOT NULL CHECK (`legacy_port_id` > 0),
  `created_at_ms` integer NOT NULL,
  UNIQUE (`legacy_item_type_key`, `legacy_item_id`, `legacy_port_id`)
) STRICT;

CREATE INDEX `port_compatibility_aliases_port_index`
  ON `port_compatibility_aliases` (`port_id`);

INSERT INTO `network_adapters` (`id`, `network_technology`, `form_factor`, `max_speed_bps`)
SELECT `id`, 'ethernet', coalesce(nullif(trim(`form_factor`), ''), 'unknown'), nullif(`max_speed_bps`, 0)
FROM `network_cards`;

INSERT INTO `network_adapters` (`id`, `network_technology`, `form_factor`, `bluetooth_version`)
SELECT
  `id`,
  'wifi',
  CASE
    WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%' THEN 'm2-2230'
    WHEN lower(coalesce(`interface`, '')) LIKE '%mini%pcie%' THEN 'mini-pcie'
    WHEN lower(coalesce(`interface`, '')) LIKE '%usb%' THEN 'usb'
    ELSE 'unknown'
  END,
  CASE WHEN `bluetooth` = 1 THEN 'supported' ELSE NULL END
FROM `wireless_cards`;

INSERT INTO `network_adapter_host_interfaces` (`adapter_id`, `family`, `interface_key`)
SELECT
  `id`,
  CASE
    WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%' THEN 'm2-ae'
    WHEN lower(coalesce(`interface`, '')) LIKE '%mini%pcie%' THEN 'mini-pcie'
    WHEN lower(coalesce(`interface`, '')) LIKE '%pcie%' OR lower(coalesce(`interface`, '')) LIKE '%pci-e%' THEN 'pcie'
    WHEN lower(coalesce(`interface`, '')) LIKE '%usb%' THEN 'usb'
    WHEN lower(coalesce(`interface`, '')) LIKE '%onboard%' THEN 'onboard'
    ELSE 'proprietary'
  END,
  CASE
    WHEN `interface` IS NULL OR trim(`interface`) = '' THEN NULL
    WHEN lower(`interface`) LIKE '%m.2%' OR lower(`interface`) LIKE '%m2%'
      OR lower(`interface`) LIKE '%mini%pcie%' OR lower(`interface`) LIKE '%pcie%'
      OR lower(`interface`) LIKE '%pci-e%' OR lower(`interface`) LIKE '%usb%'
      OR lower(`interface`) LIKE '%onboard%' THEN NULL
    ELSE trim(`interface`)
  END
FROM `network_cards`;

INSERT INTO `network_adapter_host_interfaces` (`adapter_id`, `family`, `key`, `module_size`, `interface_key`)
SELECT
  `id`,
  CASE
    WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%' THEN 'm2-ae'
    WHEN lower(coalesce(`interface`, '')) LIKE '%mini%pcie%' THEN 'mini-pcie'
    WHEN lower(coalesce(`interface`, '')) LIKE '%usb%' THEN 'usb'
    ELSE 'proprietary'
  END,
  CASE WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%' THEN 'A+E' END,
  CASE WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%' THEN '2230' END,
  CASE
    WHEN lower(coalesce(`interface`, '')) LIKE '%m.2%' OR lower(coalesce(`interface`, '')) LIKE '%m2%'
      OR lower(coalesce(`interface`, '')) LIKE '%mini%pcie%' OR lower(coalesce(`interface`, '')) LIKE '%usb%'
      OR `interface` IS NULL OR trim(`interface`) = '' THEN NULL
    ELSE trim(`interface`)
  END
FROM `wireless_cards`;

INSERT INTO `network_adapter_operating_modes` (`adapter_id`, `mode`)
SELECT `id`, 'ethernet' FROM `network_cards`;

INSERT INTO `network_adapter_operating_modes` (`adapter_id`, `mode`)
SELECT `id`, 'wifi' FROM `wireless_cards`;

INSERT INTO `network_adapter_wifi_generations` (`adapter_id`, `generation`)
SELECT `id`, trim(`wifi_generation`) FROM `wireless_cards`
WHERE `wifi_generation` IS NOT NULL AND trim(`wifi_generation`) <> '';

INSERT INTO `network_adapter_extension_values` (`adapter_id`, `field_path`, `value_type`, `text_value`)
SELECT `id`, 'legacy.interface', 'text', trim(`interface`) FROM `network_cards`
WHERE `interface` IS NOT NULL AND trim(`interface`) <> '';

INSERT INTO `network_adapter_extension_values` (`adapter_id`, `field_path`, `value_type`, `text_value`)
SELECT `id`, 'legacy.interface', 'text', trim(`interface`) FROM `wireless_cards`
WHERE `interface` IS NOT NULL AND trim(`interface`) <> '';

INSERT INTO `network_adapter_ports` (`port_id`, `adapter_id`, `network_technology`)
SELECT `inventory_ports`.`id`, `inventory_ports`.`item_id`, `network_adapters`.`network_technology`
FROM `inventory_ports`
JOIN `network_adapters` ON `network_adapters`.`id` = `inventory_ports`.`item_id`
WHERE `network_adapters`.`network_technology` NOT IN ('wifi', 'cellular');

INSERT INTO `network_adapter_port_supported_speeds` (`port_id`, `speed_bps`)
SELECT `item_port_details`.`port_id`, `item_port_details`.`speed_bps`
FROM `item_port_details`
JOIN `network_adapter_ports` ON `network_adapter_ports`.`port_id` = `item_port_details`.`port_id`
WHERE `item_port_details`.`speed_bps` IS NOT NULL AND `item_port_details`.`speed_bps` > 0;

INSERT INTO `network_adapter_port_operating_modes` (`port_id`, `mode`)
SELECT `network_adapter_ports`.`port_id`, `network_adapter_ports`.`network_technology`
FROM `network_adapter_ports`;

INSERT INTO `network_port_local_overrides` (`port_id`, `label`, `ip_address`, `role`, `updated_at_ms`)
SELECT `item_port_details`.`port_id`, `item_port_details`.`label`, `item_port_details`.`ip_address`, `item_port_details`.`role`, 0
FROM `item_port_details`
JOIN `network_adapter_ports` ON `network_adapter_ports`.`port_id` = `item_port_details`.`port_id`
WHERE `item_port_details`.`label` IS NOT NULL OR `item_port_details`.`ip_address` IS NOT NULL OR `item_port_details`.`role` IS NOT NULL;

INSERT INTO `inventory_compatibility_aliases` (`item_id`, `legacy_type_key`, `legacy_id`, `created_at_ms`)
SELECT `item_id`, `legacy_type_key`, `legacy_id`, `created_at_ms`
FROM `inventory_identity_aliases`
WHERE `legacy_type_key` = 'wireless';

INSERT INTO `port_compatibility_aliases` (
  `port_id`, `legacy_item_type_key`, `legacy_item_id`, `legacy_port_id`, `created_at_ms`
)
SELECT `port_id`, `legacy_item_type_key`, `legacy_item_id`, `legacy_port_id`, `created_at_ms`
FROM `port_identity_aliases`
WHERE `legacy_item_type_key` = 'wireless';

CREATE TEMP TABLE `network_alias_rewrites` (
  `alias_id` integer PRIMARY KEY NOT NULL,
  `network_legacy_id` integer NOT NULL UNIQUE
) STRICT;

INSERT INTO `network_alias_rewrites` (`alias_id`, `network_legacy_id`)
SELECT
  `id`,
  (SELECT coalesce(max(`legacy_id`), 0) FROM `inventory_identity_aliases`
    WHERE `legacy_type_key` IN ('network', 'wireless'))
    + row_number() OVER (ORDER BY `item_id`)
FROM `inventory_identity_aliases`
WHERE `legacy_type_key` = 'wireless';

DROP TRIGGER `inventory_identity_aliases_immutable_update`;
UPDATE `inventory_identity_aliases`
SET
  `legacy_type_key` = 'network',
  `legacy_id` = (SELECT `network_legacy_id` FROM `network_alias_rewrites` WHERE `alias_id` = `inventory_identity_aliases`.`id`)
WHERE `id` IN (SELECT `alias_id` FROM `network_alias_rewrites`);

CREATE TRIGGER `inventory_identity_aliases_immutable_update`
BEFORE UPDATE ON `inventory_identity_aliases`
BEGIN
  SELECT RAISE(ABORT, 'Inventory identity aliases are immutable.');
END;

DROP TRIGGER `port_identity_aliases_immutable_update`;
UPDATE `port_identity_aliases`
SET
  `legacy_item_type_key` = 'network',
  `legacy_item_id` = (
    SELECT `inventory_identity_aliases`.`legacy_id`
    FROM `inventory_ports`
    JOIN `inventory_identity_aliases`
      ON `inventory_identity_aliases`.`item_id` = `inventory_ports`.`item_id`
    WHERE `inventory_ports`.`id` = `port_identity_aliases`.`port_id`
  )
WHERE `legacy_item_type_key` = 'wireless';

CREATE TRIGGER `port_identity_aliases_immutable_update`
BEFORE UPDATE ON `port_identity_aliases`
BEGIN
  SELECT RAISE(ABORT, 'Port identity aliases are immutable.');
END;

DROP TABLE `network_alias_rewrites`;

UPDATE `inventory_items`
SET `type_id` = (SELECT `id` FROM `inventory_item_types` WHERE `key` = 'network')
WHERE `type_id` = (SELECT `id` FROM `inventory_item_types` WHERE `key` = 'wireless');

DROP TRIGGER IF EXISTS `network_cards_type_guard`;
DROP TRIGGER IF EXISTS `wireless_cards_type_guard`;
DROP TABLE `network_cards`;
DROP TABLE `wireless_cards`;

CREATE TRIGGER `network_adapters_type_guard` BEFORE INSERT ON `network_adapters`
WHEN COALESCE((SELECT `type_id` FROM `inventory_items` WHERE `id` = NEW.`id`), -1)
  <> COALESCE((SELECT `id` FROM `inventory_item_types` WHERE `key` = 'network'), -2)
BEGIN SELECT RAISE(ABORT, 'Network adapter subtype requires a network inventory item.'); END;

CREATE TRIGGER `network_adapter_ports_owner_guard` BEFORE INSERT ON `network_adapter_ports`
WHEN COALESCE((SELECT `item_id` FROM `inventory_ports` WHERE `id` = NEW.`port_id`), -1) <> NEW.`adapter_id`
BEGIN SELECT RAISE(ABORT, 'Network adapter port must belong to its adapter inventory item.'); END;
