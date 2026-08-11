DROP TRIGGER `port_identity_aliases_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `port_identity_aliases_immutable_delete`
BEFORE DELETE ON `port_identity_aliases`
WHEN EXISTS (
	SELECT 1 FROM `connection_endpoints` WHERE `port_id` = OLD.`port_id`
)
OR EXISTS (
	SELECT 1 FROM `internal_port_links`
	WHERE `first_port_id` = OLD.`port_id` OR `second_port_id` = OLD.`port_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Referenced port identity aliases are immutable.');
END;
--> statement-breakpoint
DROP TRIGGER `resource_identity_aliases_immutable_delete`;
--> statement-breakpoint
CREATE TRIGGER `resource_identity_aliases_immutable_delete`
BEFORE DELETE ON `resource_identity_aliases`
WHEN EXISTS (
	SELECT 1 FROM `host_resource_slots` s
	JOIN `component_assignment_slots` a ON a.`resource_slot_id` = s.`id`
	WHERE s.`resource_group_id` = OLD.`resource_id`
)
OR EXISTS (
	SELECT 1 FROM `host_resource_slots` s
	JOIN `component_assignments` a ON a.`resource_slot_id` = s.`id`
	WHERE s.`resource_group_id` = OLD.`resource_id`
)
BEGIN
	SELECT RAISE(ABORT, 'Assigned resource identity aliases are immutable.');
END;
