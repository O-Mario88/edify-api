-- AlterTable: cluster leader contact (standard cluster-creation form fields)
ALTER TABLE "Cluster" ADD COLUMN "clusterLeaderName" TEXT;
ALTER TABLE "Cluster" ADD COLUMN "clusterLeaderPhone" TEXT;

-- CreateTable: a cluster covers one OR MORE sub-counties (§4/§5 eligibility set)
CREATE TABLE "ClusterSubCounty" (
    "id" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "subCountyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClusterSubCounty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClusterSubCounty_subCountyId_idx" ON "ClusterSubCounty"("subCountyId");

-- CreateIndex
CREATE UNIQUE INDEX "ClusterSubCounty_clusterId_subCountyId_key" ON "ClusterSubCounty"("clusterId", "subCountyId");

-- AddForeignKey
ALTER TABLE "ClusterSubCounty" ADD CONSTRAINT "ClusterSubCounty_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClusterSubCounty" ADD CONSTRAINT "ClusterSubCounty_subCountyId_fkey" FOREIGN KEY ("subCountyId") REFERENCES "SubCounty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
