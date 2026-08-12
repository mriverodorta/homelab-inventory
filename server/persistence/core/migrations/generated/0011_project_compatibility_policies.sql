CREATE TABLE `project_compatibility_policies` (
  `project_id` integer PRIMARY KEY NOT NULL,
  `policy_json` text DEFAULT '{"disabledHosts":[],"ignoredWarningIds":[]}' NOT NULL,
  `updated_at_ms` integer NOT NULL,
  FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
  CONSTRAINT "project_compatibility_policies_json_check" CHECK(json_valid(`policy_json`))
) STRICT;
--> statement-breakpoint
INSERT INTO `project_compatibility_policies` (`project_id`, `policy_json`, `updated_at_ms`)
SELECT
  `projects`.`id`,
  CASE
    WHEN `projects`.`id` = 1 THEN coalesce(
      (SELECT `value_json` FROM `application_metadata` WHERE `key` = 'legacy.compatibility-policy'),
      '{"disabledHosts":[],"ignoredWarningIds":[]}'
    )
    ELSE '{"disabledHosts":[],"ignoredWarningIds":[]}'
  END,
  `projects`.`updated_at_ms`
FROM `projects`;
