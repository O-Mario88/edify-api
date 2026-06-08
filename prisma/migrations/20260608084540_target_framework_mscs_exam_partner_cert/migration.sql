-- CreateEnum
CREATE TYPE "TargetType" AS ENUM ('SCHOOL_REACH', 'STAFF_DIRECT_SUPPORT', 'PARTNER_SUPPORT', 'TRAINING', 'SSA', 'SCHOOL_VISIT', 'MSCS', 'EXAM_RESULTS', 'CORE_PACKAGE', 'PROJECT_SUPPORT', 'IA_VERIFICATION', 'ACCOUNTABILITY');

-- CreateEnum
CREATE TYPE "TargetScopeType" AS ENUM ('country', 'region', 'district', 'cluster', 'staff', 'pl_team', 'partner', 'project', 'school_type');

-- CreateEnum
CREATE TYPE "TargetUnit" AS ENUM ('count', 'percentage');

-- CreateEnum
CREATE TYPE "MscsReviewStatus" AS ENUM ('draft', 'submitted', 'reviewed', 'approved', 'returned', 'rejected', 'donor_ready');

-- CreateEnum
CREATE TYPE "ExamCollectionStatus" AS ENUM ('missing', 'collected', 'validated', 'returned', 'approved');

-- AlterTable
ALTER TABLE "Partner" ADD COLUMN     "activeStatus" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "certificationStatus" TEXT,
ADD COLUMN     "expertiseAreas" TEXT[],
ADD COLUMN     "isCertified" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TargetSetting" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "targetType" "TargetType" NOT NULL,
    "scopeType" "TargetScopeType" NOT NULL,
    "scopeId" TEXT,
    "targetValue" DOUBLE PRECISION,
    "targetUnit" "TargetUnit" NOT NULL DEFAULT 'percentage',
    "targetPercentage" DOUBLE PRECISION,
    "quarterDistribution" JSONB,
    "setByUserId" TEXT NOT NULL,
    "setByRole" "EdifyRole" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MostSignificantChangeStory" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "quarter" TEXT,
    "schoolId" TEXT,
    "clusterId" TEXT,
    "districtId" TEXT,
    "regionId" TEXT,
    "submittedByStaffId" TEXT,
    "submittedByRole" "EdifyRole",
    "relatedInterventionId" TEXT,
    "relatedProjectId" TEXT,
    "storyTitle" TEXT NOT NULL,
    "storySummary" TEXT,
    "storyText" TEXT,
    "evidenceAttachmentId" TEXT,
    "consentStatus" TEXT,
    "reviewStatus" "MscsReviewStatus" NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MostSignificantChangeStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResultCollection" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "examType" TEXT,
    "examYear" INTEGER,
    "collectionDate" TIMESTAMP(3),
    "collectedByStaffId" TEXT,
    "uploadedByIA" TEXT,
    "status" "ExamCollectionStatus" NOT NULL DEFAULT 'missing',
    "attachmentId" TEXT,
    "resultsSummaryJson" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ExamResultCollection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetSetting_fy_targetType_idx" ON "TargetSetting"("fy", "targetType");

-- CreateIndex
CREATE INDEX "TargetSetting_scopeType_scopeId_idx" ON "TargetSetting"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "TargetSetting_isActive_idx" ON "TargetSetting"("isActive");

-- CreateIndex
CREATE INDEX "MostSignificantChangeStory_fy_quarter_idx" ON "MostSignificantChangeStory"("fy", "quarter");

-- CreateIndex
CREATE INDEX "MostSignificantChangeStory_schoolId_idx" ON "MostSignificantChangeStory"("schoolId");

-- CreateIndex
CREATE INDEX "MostSignificantChangeStory_reviewStatus_idx" ON "MostSignificantChangeStory"("reviewStatus");

-- CreateIndex
CREATE INDEX "ExamResultCollection_fy_idx" ON "ExamResultCollection"("fy");

-- CreateIndex
CREATE INDEX "ExamResultCollection_schoolId_idx" ON "ExamResultCollection"("schoolId");

-- CreateIndex
CREATE INDEX "ExamResultCollection_status_idx" ON "ExamResultCollection"("status");
