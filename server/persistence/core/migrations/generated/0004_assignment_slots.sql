CREATE UNIQUE INDEX `component_assignments_project_id_unique` ON `component_assignments` (`project_id`,`id`);--> statement-breakpoint
CREATE TABLE `component_assignment_slots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`assignment_id` integer NOT NULL,
	`host_item_id` integer NOT NULL,
	`resource_slot_id` integer NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`project_id`,`assignment_id`) REFERENCES `component_assignments`(`project_id`,`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_item_id`,`resource_slot_id`) REFERENCES `host_resource_slots`(`host_item_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "component_assignment_slots_position_check" CHECK("component_assignment_slots"."position" >= 0)
) STRICT;
--> statement-breakpoint
INSERT INTO `component_assignment_slots` (
	`project_id`, `assignment_id`, `host_item_id`, `resource_slot_id`, `position`
)
SELECT `project_id`, `id`, `host_item_id`, `resource_slot_id`, 0
FROM `component_assignments`
WHERE `resource_slot_id` IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `component_assignment_slots_assignment_position_unique` ON `component_assignment_slots` (`assignment_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `component_assignment_slots_assignment_slot_unique` ON `component_assignment_slots` (`assignment_id`,`resource_slot_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `component_assignment_slots_project_slot_unique` ON `component_assignment_slots` (`project_id`,`resource_slot_id`);
