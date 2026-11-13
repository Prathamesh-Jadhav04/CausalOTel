-- M-03: track inventory commit attempts so a captured payment that can never
-- be paired with committed inventory is escalated to a refund instead of
-- retrying forever. The counter is incremented only by the lease owner.
ALTER TABLE saga_instances ADD COLUMN commit_attempts INTEGER NOT NULL DEFAULT 0;
