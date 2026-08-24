ALTER TABLE sharing_installation_projection ADD COLUMN account_claimed integer NOT NULL DEFAULT 0 CHECK(account_claimed IN (0,1));
ALTER TABLE sharing_installation_projection ADD COLUMN github_username text;
ALTER TABLE sharing_installation_projection ADD COLUMN account_claimed_at_ms integer CHECK(account_claimed_at_ms IS NULL OR account_claimed_at_ms > 0);

UPDATE sharing_installation_projection
SET account_claimed = 1
WHERE id = 1 AND EXISTS(SELECT 1 FROM shares WHERE account_claimed = 1);
