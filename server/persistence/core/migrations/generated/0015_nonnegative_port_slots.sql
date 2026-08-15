DROP TRIGGER IF EXISTS `item_port_details_group_ownership_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `item_port_details_slot_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `connection_endpoints_kind_guard`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `connection_endpoints_power_direction_guard`;
--> statement-breakpoint
CREATE TABLE `item_port_details_new` (
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
	CONSTRAINT "item_port_details_slot_check" CHECK("slot_number" >= 0),
	CONSTRAINT "item_port_details_role_check" CHECK(
    "role" IS NULL OR "role" IN ('access', 'trunk', 'uplink', 'management', 'disabled')
  ),
	CONSTRAINT "item_port_details_speed_check" CHECK("speed_bps" IS NULL OR "speed_bps" >= 0),
	CONSTRAINT "item_port_details_poe_check" CHECK("poe" IS NULL OR "poe" IN (0, 1)),
	CONSTRAINT "item_port_details_origin_check" CHECK("origin" IN ('fixed', 'module'))
) STRICT;
--> statement-breakpoint
INSERT INTO `item_port_details_new` (
  `port_id`, `port_group_id`, `kind_id`, `connector_type_id`, `semantic_key`,
  `slot_number`, `label`, `notes`, `ip_address`, `role`, `speed_bps`, `poe`, `origin`
)
SELECT
  `port_id`, `port_group_id`, `kind_id`, `connector_type_id`, `semantic_key`,
  `slot_number`, `label`, `notes`, `ip_address`, `role`, `speed_bps`, `poe`, `origin`
FROM `item_port_details`;
--> statement-breakpoint
DROP TABLE `item_port_details`;
--> statement-breakpoint
ALTER TABLE `item_port_details_new` RENAME TO `item_port_details`;
--> statement-breakpoint
CREATE INDEX `item_port_details_group_index` ON `item_port_details` (`port_group_id`);
--> statement-breakpoint
CREATE INDEX `item_port_details_kind_index` ON `item_port_details` (`kind_id`);
--> statement-breakpoint
CREATE INDEX `item_port_details_connector_index` ON `item_port_details` (`connector_type_id`);
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
