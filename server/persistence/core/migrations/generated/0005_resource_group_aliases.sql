ALTER TABLE `resource_identity_aliases`
ADD `legacy_resource_group_id` integer
CHECK (`legacy_resource_group_id` IS NULL OR `legacy_resource_group_id` > 0);
