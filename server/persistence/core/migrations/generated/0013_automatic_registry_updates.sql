ALTER TABLE `registry_settings` ADD `automatic_safe_updates` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE `registry_update_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_id` integer NOT NULL,
	`catalog_revision` integer NOT NULL,
	`state` text NOT NULL,
	`automatic` integer DEFAULT true NOT NULL,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`review_count` integer DEFAULT 0 NOT NULL,
	`blocked_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`retry_after_ms` integer,
	`error` text,
	`started_at_ms` integer NOT NULL,
	`completed_at_ms` integer,
	FOREIGN KEY (`source_id`) REFERENCES `registry_sources`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "registry_update_runs_revision_check" CHECK("registry_update_runs"."catalog_revision" > 0),
	CONSTRAINT "registry_update_runs_state_check" CHECK("registry_update_runs"."state" IN ('running', 'completed', 'failed')),
	CONSTRAINT "registry_update_runs_counts_check" CHECK("registry_update_runs"."applied_count" >= 0 AND "registry_update_runs"."review_count" >= 0 AND "registry_update_runs"."blocked_count" >= 0 AND "registry_update_runs"."skipped_count" >= 0 AND "registry_update_runs"."attempt_count" >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_update_runs_source_revision_unique` ON `registry_update_runs` (`source_id`,`catalog_revision`);
--> statement-breakpoint
CREATE TABLE `registry_update_evaluations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` integer NOT NULL,
	`link_id` integer NOT NULL,
	`from_revision` integer NOT NULL,
	`to_revision` integer NOT NULL,
	`target_content_hash` text NOT NULL,
	`classification` text NOT NULL,
	`decision` text NOT NULL,
	`reasons_json` text DEFAULT '[]' NOT NULL,
	`changes_json` text DEFAULT '[]' NOT NULL,
	`decided_by_user_id` integer,
	`evaluated_at_ms` integer NOT NULL,
	`decided_at_ms` integer,
	FOREIGN KEY (`run_id`) REFERENCES `registry_update_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`link_id`) REFERENCES `registry_links`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "registry_update_evaluations_revision_check" CHECK("registry_update_evaluations"."from_revision" > 0 AND "registry_update_evaluations"."to_revision" >= "registry_update_evaluations"."from_revision"),
	CONSTRAINT "registry_update_evaluations_hash_check" CHECK(length("registry_update_evaluations"."target_content_hash") = 64),
	CONSTRAINT "registry_update_evaluations_classification_check" CHECK("registry_update_evaluations"."classification" IN ('safe', 'review-required', 'blocked', 'skipped')),
	CONSTRAINT "registry_update_evaluations_decision_check" CHECK("registry_update_evaluations"."decision" IN ('pending', 'applied', 'declined', 'superseded', 'failed')),
	CONSTRAINT "registry_update_evaluations_reasons_json_check" CHECK(json_valid("registry_update_evaluations"."reasons_json") AND json_array_length("registry_update_evaluations"."reasons_json") >= 0),
	CONSTRAINT "registry_update_evaluations_changes_json_check" CHECK(json_valid("registry_update_evaluations"."changes_json") AND json_array_length("registry_update_evaluations"."changes_json") >= 0)
) STRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX `registry_update_evaluations_run_link_unique` ON `registry_update_evaluations` (`run_id`,`link_id`);
--> statement-breakpoint
CREATE INDEX `registry_update_evaluations_review_index` ON `registry_update_evaluations` (`decision`,`classification`);
