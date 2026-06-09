CREATE TYPE "FundRequestPeriod" AS ENUM ('weekly', 'monthly', 'quarterly', 'annual');
CREATE TYPE "FundRequestStatus" AS ENUM ('submitted', 'approved', 'rejected', 'disbursed');
CREATE TABLE "FundRequest" (
  "id" TEXT NOT NULL,
  "fy" TEXT NOT NULL,
  "period" "FundRequestPeriod" NOT NULL,
  "periodKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "submittedByUserId" TEXT NOT NULL,
  "submittedByRole" "EdifyRole" NOT NULL,
  "totalAmount" DOUBLE PRECISION NOT NULL,
  "activityCount" INTEGER NOT NULL,
  "status" "FundRequestStatus" NOT NULL DEFAULT 'submitted',
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FundRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "FundRequest_status_idx" ON "FundRequest"("status");
CREATE INDEX "FundRequest_fy_period_idx" ON "FundRequest"("fy", "period");
CREATE INDEX "FundRequest_submittedByUserId_idx" ON "FundRequest"("submittedByUserId");
