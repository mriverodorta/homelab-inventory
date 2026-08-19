INSERT INTO `compatibility_audit_dirty_hosts` (`project_id`, `host_item_id`, `reason`, `enqueued_at_ms`)
SELECT project.id, item.id, 'compatibility-evaluator-v2', unixepoch('subsec') * 1000
FROM `projects` project
JOIN `inventory_items` item ON item.archived_at_ms IS NULL
JOIN `inventory_item_types` item_type ON item_type.id = item.type_id
LEFT JOIN `project_inventory_memberships` membership
  ON membership.project_id = project.id AND membership.item_id = item.id
WHERE project.archived_at_ms IS NULL
AND item_type.key IN ('server', 'nas', 'pcBuild')
AND (
  item.owner_project_id = project.id
  OR membership.id IS NOT NULL
  OR (item.scope = 'global' AND project.includes_global_inventory = 1)
)
ON CONFLICT (`project_id`, `host_item_id`) DO UPDATE SET
  `reason` = excluded.`reason`,
  `enqueued_at_ms` = excluded.`enqueued_at_ms`;
