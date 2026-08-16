-- Repair canonical M.2 metadata omitted by the v11 legacy-network migration.
-- Only fill null destinations when preserved evidence yields exactly one value.

WITH `adapter_evidence` AS (
  SELECT
    `interfaces`.`adapter_id`,
    `interfaces`.`family`,
    lower(
      coalesce(`adapters`.`form_factor`, '') || ' ' ||
      coalesce(group_concat(`extensions`.`text_value`, ' '), '')
    ) AS `evidence`
  FROM `network_adapter_host_interfaces` AS `interfaces`
  JOIN `network_adapters` AS `adapters` ON `adapters`.`id` = `interfaces`.`adapter_id`
  LEFT JOIN `network_adapter_extension_values` AS `extensions`
    ON `extensions`.`adapter_id` = `interfaces`.`adapter_id`
    AND `extensions`.`field_path` = 'legacy.interface'
    AND `extensions`.`value_type` = 'text'
  WHERE `interfaces`.`family` IN ('m2-ae', 'm2-bm')
  GROUP BY `interfaces`.`adapter_id`, `interfaces`.`family`, `adapters`.`form_factor`
),
`adapter_key_candidates` AS (
  SELECT `adapter_id`, 'A+E' AS `candidate`
  FROM `adapter_evidence`
  WHERE `family` = 'm2-ae'
    AND (
      `evidence` LIKE '%a+e%' OR `evidence` LIKE '%a/e%' OR
      `evidence` LIKE '%m2-ae%' OR `evidence` LIKE '%m.2-ae%'
    )
  UNION ALL
  SELECT `adapter_id`, 'B+M' AS `candidate`
  FROM `adapter_evidence`
  WHERE `family` = 'm2-bm'
    AND (
      `evidence` LIKE '%b+m%' OR `evidence` LIKE '%b/m%' OR
      `evidence` LIKE '%m2-bm%' OR `evidence` LIKE '%m.2-bm%'
    )
),
`unique_adapter_keys` AS (
  SELECT `adapter_id`, min(`candidate`) AS `candidate`
  FROM `adapter_key_candidates`
  GROUP BY `adapter_id`
  HAVING count(DISTINCT `candidate`) = 1
)
UPDATE `network_adapter_host_interfaces`
SET `key` = (
  SELECT `candidate` FROM `unique_adapter_keys`
  WHERE `unique_adapter_keys`.`adapter_id` = `network_adapter_host_interfaces`.`adapter_id`
)
WHERE `key` IS NULL
  AND `adapter_id` IN (SELECT `adapter_id` FROM `unique_adapter_keys`);

WITH `adapter_evidence` AS (
  SELECT
    `interfaces`.`adapter_id`,
    lower(
      coalesce(`adapters`.`form_factor`, '') || ' ' ||
      coalesce(group_concat(`extensions`.`text_value`, ' '), '')
    ) AS `evidence`
  FROM `network_adapter_host_interfaces` AS `interfaces`
  JOIN `network_adapters` AS `adapters` ON `adapters`.`id` = `interfaces`.`adapter_id`
  LEFT JOIN `network_adapter_extension_values` AS `extensions`
    ON `extensions`.`adapter_id` = `interfaces`.`adapter_id`
    AND `extensions`.`field_path` = 'legacy.interface'
    AND `extensions`.`value_type` = 'text'
  WHERE `interfaces`.`family` IN ('m2-ae', 'm2-bm')
  GROUP BY `interfaces`.`adapter_id`, `adapters`.`form_factor`
),
`adapter_size_candidates` AS (
  SELECT `adapter_id`, '2230' AS `candidate` FROM `adapter_evidence` WHERE instr(`evidence`, '2230') > 0
  UNION ALL SELECT `adapter_id`, '2242' FROM `adapter_evidence` WHERE instr(`evidence`, '2242') > 0
  UNION ALL SELECT `adapter_id`, '2260' FROM `adapter_evidence` WHERE instr(`evidence`, '2260') > 0
  UNION ALL SELECT `adapter_id`, '2280' FROM `adapter_evidence` WHERE instr(`evidence`, '2280') > 0
  UNION ALL SELECT `adapter_id`, '22110' FROM `adapter_evidence` WHERE instr(`evidence`, '22110') > 0
),
`unique_adapter_sizes` AS (
  SELECT `adapter_id`, min(`candidate`) AS `candidate`
  FROM `adapter_size_candidates`
  GROUP BY `adapter_id`
  HAVING count(DISTINCT `candidate`) = 1
)
UPDATE `network_adapter_host_interfaces`
SET `module_size` = (
  SELECT `candidate` FROM `unique_adapter_sizes`
  WHERE `unique_adapter_sizes`.`adapter_id` = `network_adapter_host_interfaces`.`adapter_id`
)
WHERE `module_size` IS NULL
  AND `adapter_id` IN (SELECT `adapter_id` FROM `unique_adapter_sizes`);

WITH `host_evidence` AS (
  SELECT
    `expansion`.`id`,
    `expansion`.`interface_family`,
    lower(`groups`.`semantic_key` || ' ' || `groups`.`label`) AS `evidence`
  FROM `expansion_resource_groups` AS `expansion`
  JOIN `host_resource_groups` AS `groups` ON `groups`.`id` = `expansion`.`id`
  WHERE `expansion`.`interface_family` IN ('m2-ae', 'm2-bm')
),
`host_key_candidates` AS (
  SELECT `id`, 'A+E' AS `candidate`
  FROM `host_evidence`
  WHERE `interface_family` = 'm2-ae'
    AND (
      `evidence` LIKE '%a+e%' OR `evidence` LIKE '%a/e%' OR
      `evidence` LIKE '%m2-ae%' OR `evidence` LIKE '%m.2-ae%'
    )
  UNION ALL
  SELECT `id`, 'B+M' AS `candidate`
  FROM `host_evidence`
  WHERE `interface_family` = 'm2-bm'
    AND (
      `evidence` LIKE '%b+m%' OR `evidence` LIKE '%b/m%' OR
      `evidence` LIKE '%m2-bm%' OR `evidence` LIKE '%m.2-bm%'
    )
),
`unique_host_keys` AS (
  SELECT `id`, min(`candidate`) AS `candidate`
  FROM `host_key_candidates`
  GROUP BY `id`
  HAVING count(DISTINCT `candidate`) = 1
)
UPDATE `expansion_resource_groups`
SET `keying` = (
  SELECT `candidate` FROM `unique_host_keys`
  WHERE `unique_host_keys`.`id` = `expansion_resource_groups`.`id`
)
WHERE `keying` IS NULL
  AND `id` IN (SELECT `id` FROM `unique_host_keys`);

WITH `host_evidence` AS (
  SELECT
    `expansion`.`id`,
    lower(`groups`.`semantic_key` || ' ' || `groups`.`label`) AS `evidence`
  FROM `expansion_resource_groups` AS `expansion`
  JOIN `host_resource_groups` AS `groups` ON `groups`.`id` = `expansion`.`id`
  WHERE `expansion`.`interface_family` IN ('m2-ae', 'm2-bm')
),
`host_size_candidates` AS (
  SELECT `id`, '2230' AS `candidate` FROM `host_evidence` WHERE instr(`evidence`, '2230') > 0
  UNION ALL SELECT `id`, '2242' FROM `host_evidence` WHERE instr(`evidence`, '2242') > 0
  UNION ALL SELECT `id`, '2260' FROM `host_evidence` WHERE instr(`evidence`, '2260') > 0
  UNION ALL SELECT `id`, '2280' FROM `host_evidence` WHERE instr(`evidence`, '2280') > 0
  UNION ALL SELECT `id`, '22110' FROM `host_evidence` WHERE instr(`evidence`, '22110') > 0
),
`unique_host_sizes` AS (
  SELECT `id`, min(`candidate`) AS `candidate`
  FROM `host_size_candidates`
  GROUP BY `id`
  HAVING count(DISTINCT `candidate`) = 1
)
UPDATE `expansion_resource_groups`
SET `module_size` = (
  SELECT `candidate` FROM `unique_host_sizes`
  WHERE `unique_host_sizes`.`id` = `expansion_resource_groups`.`id`
)
WHERE `module_size` IS NULL
  AND `id` IN (SELECT `id` FROM `unique_host_sizes`);
