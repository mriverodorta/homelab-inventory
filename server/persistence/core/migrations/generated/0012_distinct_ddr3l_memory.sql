INSERT INTO `memory_generations` (`key`, `label`, `sort_order`)
SELECT 'ddr3l', 'DDR3L', (
  SELECT coalesce(max(`sort_order`), 0) + 1 FROM `memory_generations`
)
WHERE NOT EXISTS (
  SELECT 1 FROM `memory_generations` WHERE `key` = 'ddr3l'
);
--> statement-breakpoint
UPDATE `memory_modules`
SET `memory_generation_id` = (
  SELECT `id` FROM `memory_generations` WHERE `key` = 'ddr3l'
)
WHERE lower(trim(json_extract(
  (SELECT `extensions_json` FROM `inventory_items` WHERE `id` = `memory_modules`.`id`),
  '$.legacySpecs.generation'
))) = 'ddr3l';
--> statement-breakpoint
DELETE FROM `host_memory_generation_support`
WHERE `generation_id` = (SELECT `id` FROM `memory_generations` WHERE `key` = 'ddr3')
  AND `memory_profile_id` IN (
    SELECT `memory`.`id`
    FROM `host_memory_profiles` AS `memory`
    JOIN `host_compatibility_profiles` AS `host` ON `host`.`id` = `memory`.`host_profile_id`
    JOIN `inventory_items` AS `item` ON `item`.`id` = `host`.`host_item_id`
    WHERE EXISTS (
      SELECT 1
      FROM json_each(json_extract(`item`.`extensions_json`, '$.catalogCompatibility.host.memory.generations'))
      WHERE lower(trim(json_each.value)) = 'ddr3l'
    )
      AND NOT EXISTS (
        SELECT 1
        FROM json_each(json_extract(`item`.`extensions_json`, '$.catalogCompatibility.host.memory.generations'))
        WHERE lower(trim(json_each.value)) = 'ddr3'
      )
  );
--> statement-breakpoint
INSERT OR IGNORE INTO `host_memory_generation_support` (`memory_profile_id`, `generation_id`)
SELECT `memory`.`id`, `generation`.`id`
FROM `host_memory_profiles` AS `memory`
JOIN `host_compatibility_profiles` AS `host` ON `host`.`id` = `memory`.`host_profile_id`
JOIN `inventory_items` AS `item` ON `item`.`id` = `host`.`host_item_id`
JOIN `memory_generations` AS `generation` ON `generation`.`key` = 'ddr3l'
WHERE EXISTS (
  SELECT 1
  FROM json_each(json_extract(`item`.`extensions_json`, '$.catalogCompatibility.host.memory.generations'))
  WHERE lower(trim(json_each.value)) = 'ddr3l'
);
