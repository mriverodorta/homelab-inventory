DROP TRIGGER IF EXISTS `systems_workspace_delete_guard`;

CREATE TRIGGER `systems_workspace_delete_guard`
BEFORE DELETE ON `workspaces`
WHEN OLD.`type` = 'systems'
  AND EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = OLD.`project_id` AND `archived_at_ms` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'The Systems workspace cannot be deleted.');
END;

DROP TRIGGER IF EXISTS `last_canvas_workspace_delete_guard`;

CREATE TRIGGER `last_canvas_workspace_delete_guard`
BEFORE DELETE ON `workspaces`
WHEN OLD.`type` = 'canvas'
  AND OLD.`archived_at_ms` IS NULL
  AND EXISTS (
    SELECT 1 FROM `projects`
    WHERE `id` = OLD.`project_id` AND `archived_at_ms` IS NULL
  )
  AND (
    SELECT COUNT(*) FROM `workspaces`
    WHERE `project_id` = OLD.`project_id`
      AND `type` = 'canvas'
      AND `archived_at_ms` IS NULL
  ) = 1
BEGIN
  SELECT RAISE(ABORT, 'A project must retain at least one Canvas workspace.');
END;

UPDATE `projects`
SET `name` = 'Default Project', `updated_at_ms` = unixepoch('subsec') * 1000
WHERE `id` = 1 AND `name` = 'Homelab Inventory';
