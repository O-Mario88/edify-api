-- CreateEnum
CREATE TYPE "SsaCollectorType" AS ENUM ('staff', 'partner', 'ia', 'imported_previous_fy', 'system_migration');

-- AlterTable
ALTER TABLE "SsaRecord" ADD COLUMN     "collectedByPartnerId" TEXT,
ADD COLUMN     "collectedByUserId" TEXT,
ADD COLUMN     "collectorType" "SsaCollectorType" NOT NULL DEFAULT 'staff',
ADD COLUMN     "qaReviewedAt" TIMESTAMP(3),
ADD COLUMN     "qaReviewedByUserId" TEXT,
ADD COLUMN     "verificationSource" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedByUserId" TEXT;

-- CreateIndex
CREATE INDEX "SsaRecord_collectorType_idx" ON "SsaRecord"("collectorType");

-- CreateIndex
CREATE INDEX "SsaRecord_verificationStatus_idx" ON "SsaRecord"("verificationStatus");
