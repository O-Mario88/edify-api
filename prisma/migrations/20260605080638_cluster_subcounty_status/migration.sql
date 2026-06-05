-- CreateEnum
CREATE TYPE "ClusterRecordStatus" AS ENUM ('active', 'needs_review', 'inactive');

-- CreateEnum
CREATE TYPE "ClusterType" AS ENUM ('client', 'core', 'mixed');

-- AlterTable
ALTER TABLE "Cluster" ADD COLUMN     "clusterType" "ClusterType" NOT NULL DEFAULT 'mixed',
ADD COLUMN     "overrideReason" TEXT,
ADD COLUMN     "responsibleStaffId" TEXT,
ADD COLUMN     "status" "ClusterRecordStatus" NOT NULL DEFAULT 'active',
ADD COLUMN     "subCountyId" TEXT;

-- AlterTable
ALTER TABLE "SubCounty" ADD COLUMN     "seeded" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Cluster_subCountyId_idx" ON "Cluster"("subCountyId");

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_subCountyId_fkey" FOREIGN KEY ("subCountyId") REFERENCES "SubCounty"("id") ON DELETE SET NULL ON UPDATE CASCADE;
