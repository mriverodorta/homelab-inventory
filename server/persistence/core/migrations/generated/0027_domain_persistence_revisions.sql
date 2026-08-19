ALTER TABLE `projects`
  ADD COLUMN `workbook_revision` integer NOT NULL DEFAULT 1
  CONSTRAINT `projects_workbook_revision_check` CHECK (`workbook_revision` > 0);

UPDATE `projects`
SET `workbook_revision` = `revision`;

ALTER TABLE `project_compatibility_policies`
  ADD COLUMN `revision` integer NOT NULL DEFAULT 1
  CONSTRAINT `project_compatibility_policies_revision_check` CHECK (`revision` > 0);

CREATE TABLE `inventory_item_metadata_revisions` (
  `item_id` integer PRIMARY KEY NOT NULL
    REFERENCES `inventory_items` (`id`) ON DELETE CASCADE,
  `revision` integer NOT NULL DEFAULT 1,
  `updated_at_ms` integer NOT NULL,
  CONSTRAINT `inventory_item_metadata_revisions_revision_check` CHECK (`revision` > 0)
) STRICT;

INSERT INTO `inventory_item_metadata_revisions` (`item_id`, `revision`, `updated_at_ms`)
SELECT `id`, 1, `updated_at_ms`
FROM `inventory_items`;
