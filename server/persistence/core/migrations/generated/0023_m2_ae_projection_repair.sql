INSERT OR IGNORE INTO `optional_module_intended_kinds` (`resource_group_id`, `kind`)
SELECT accepted.resource_group_id, accepted.kind
FROM `resource_accepted_kinds` accepted
JOIN `optional_module_resource_groups` optional_module
  ON optional_module.id = accepted.resource_group_id
WHERE optional_module.interface_family = 'm2-ae';
--> statement-breakpoint
DELETE FROM `resource_accepted_kinds`
WHERE resource_group_id IN (
  SELECT id FROM `optional_module_resource_groups`
  WHERE interface_family = 'm2-ae'
);
--> statement-breakpoint
INSERT INTO `compatibility_audit_dirty_hosts` (`project_id`, `host_item_id`, `reason`, `enqueued_at_ms`)
SELECT project.id, item.id, 'catalog-contract-v12-projection-repair', unixepoch('subsec') * 1000
FROM `projects` project
JOIN `inventory_items` item ON item.archived_at_ms IS NULL
JOIN `inventory_item_types` item_type ON item_type.id = item.type_id
LEFT JOIN `project_inventory_memberships` membership
  ON membership.project_id = project.id AND membership.item_id = item.id
WHERE project.archived_at_ms IS NULL
AND item_type.key IN ('server', 'nas', 'pcBuild')
AND EXISTS (
  SELECT 1
  FROM `host_resource_groups` resource
  JOIN `optional_module_resource_groups` optional_module ON optional_module.id = resource.id
  WHERE resource.host_item_id = item.id
    AND optional_module.interface_family = 'm2-ae'
)
AND (
  item.owner_project_id = project.id
  OR membership.id IS NOT NULL
  OR (item.scope = 'global' AND project.includes_global_inventory = 1)
)
ON CONFLICT (`project_id`, `host_item_id`) DO UPDATE SET
  `reason` = excluded.`reason`,
  `enqueued_at_ms` = excluded.`enqueued_at_ms`;
