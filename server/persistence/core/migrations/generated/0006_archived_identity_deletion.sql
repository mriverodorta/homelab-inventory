DROP TRIGGER `inventory_identity_aliases_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `inventory_identity_aliases_immutable_delete`
BEFORE DELETE ON `inventory_identity_aliases`
WHEN COALESCE((SELECT `archived_at_ms` FROM `inventory_items` WHERE `id` = OLD.`item_id`), 0) = 0
BEGIN
	SELECT RAISE(ABORT, 'Inventory identity aliases are immutable for active items.');
END;
--> statement-breakpoint
DROP TRIGGER `port_identity_aliases_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `port_identity_aliases_immutable_delete`
BEFORE DELETE ON `port_identity_aliases`
WHEN COALESCE((
	SELECT i.`archived_at_ms`
	FROM `inventory_ports` p
	JOIN `inventory_items` i ON i.`id` = p.`item_id`
	WHERE p.`id` = OLD.`port_id`
), 0) = 0
BEGIN
	SELECT RAISE(ABORT, 'Port identity aliases are immutable for active items.');
END;
--> statement-breakpoint
DROP TRIGGER `resource_identity_aliases_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `resource_identity_aliases_immutable_delete`
BEFORE DELETE ON `resource_identity_aliases`
WHEN COALESCE((
	SELECT i.`archived_at_ms`
	FROM `inventory_resources` r
	JOIN `inventory_items` i ON i.`id` = r.`item_id`
	WHERE r.`id` = OLD.`resource_id`
), 0) = 0
BEGIN
	SELECT RAISE(ABORT, 'Resource identity aliases are immutable for active items.');
END;
