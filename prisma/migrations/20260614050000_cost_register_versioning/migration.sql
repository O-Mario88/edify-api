-- Versioned Country Cost Register: per-rate version + append-only change history.
ALTER TABLE "CostSetting" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "CostSettingHistory" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "oldUnitCost" DOUBLE PRECISION,
    "newUnitCost" DOUBLE PRECISION NOT NULL,
    "version" INTEGER NOT NULL,
    "fy" TEXT,
    "changedByUserId" TEXT NOT NULL,
    "reason" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CostSettingHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CostSettingHistory_key_idx" ON "CostSettingHistory"("key");
CREATE INDEX "CostSettingHistory_changedAt_idx" ON "CostSettingHistory"("changedAt");
