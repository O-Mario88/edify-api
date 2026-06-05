-- One ACTIVE cluster per sub-county, enforced at the database (closes the
-- check-then-create race). A 2nd active cluster in the same sub-county is
-- rejected with a unique violation; the service converts that into the
-- override workflow (needs_review). needs_review/inactive clusters are exempt.
CREATE UNIQUE INDEX IF NOT EXISTS "cluster_one_active_per_subcounty"
  ON "Cluster" ("subCountyId")
  WHERE "status" = 'active' AND "deletedAt" IS NULL AND "subCountyId" IS NOT NULL;
