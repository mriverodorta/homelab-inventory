ALTER TABLE `registry_update_runs`
ADD COLUMN `evaluator_version` integer NOT NULL DEFAULT 1
CHECK (`evaluator_version` > 0);
