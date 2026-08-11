CREATE TABLE `agent_identity_aliases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` integer NOT NULL,
	`legacy_id` integer NOT NULL,
	`created_at_ms` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "agent_identity_aliases_legacy_id_check" CHECK(`legacy_id` > 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identity_aliases_agent_unique` ON `agent_identity_aliases` (`agent_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_identity_aliases_legacy_unique` ON `agent_identity_aliases` (`legacy_id`);
