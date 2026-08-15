CREATE INDEX `registry_update_evaluations_link_target_index`
ON `registry_update_evaluations` (`link_id`, `to_revision`, `target_content_hash`);
--> statement-breakpoint
CREATE INDEX `registry_update_evaluations_link_latest_index`
ON `registry_update_evaluations` (`link_id`, `evaluated_at_ms`, `id`);
--> statement-breakpoint
UPDATE `registry_update_evaluations` AS evaluation
SET `decision` = 'superseded',
    `decided_at_ms` = coalesce(`decided_at_ms`, `evaluated_at_ms`)
WHERE evaluation.`decision` = 'pending'
  AND (
    EXISTS (
      SELECT 1
      FROM `registry_update_evaluations` AS newer
      WHERE newer.`link_id` = evaluation.`link_id`
        AND (
          newer.`evaluated_at_ms` > evaluation.`evaluated_at_ms`
          OR (
            newer.`evaluated_at_ms` = evaluation.`evaluated_at_ms`
            AND newer.`id` > evaluation.`id`
          )
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM `registry_links` AS link
      WHERE link.`id` = evaluation.`link_id`
        AND link.`state` IN ('update-available', 'adoption-available')
        AND link.`available_revision` = evaluation.`to_revision`
        AND link.`available_content_hash` = evaluation.`target_content_hash`
    )
  );
--> statement-breakpoint
CREATE VIEW `registry_current_update_evaluations` AS
SELECT evaluation.*
FROM `registry_update_evaluations` AS evaluation
JOIN `registry_links` AS link ON link.`id` = evaluation.`link_id`
WHERE evaluation.`decision` = 'pending'
  AND link.`state` IN ('update-available', 'adoption-available')
  AND link.`available_revision` = evaluation.`to_revision`
  AND link.`available_content_hash` = evaluation.`target_content_hash`
  AND NOT EXISTS (
    SELECT 1
    FROM `registry_update_evaluations` AS newer
    WHERE newer.`link_id` = evaluation.`link_id`
      AND (
        newer.`evaluated_at_ms` > evaluation.`evaluated_at_ms`
        OR (
          newer.`evaluated_at_ms` = evaluation.`evaluated_at_ms`
          AND newer.`id` > evaluation.`id`
        )
      )
  );
