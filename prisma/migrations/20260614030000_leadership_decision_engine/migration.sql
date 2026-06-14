-- Leadership Decision Engine — evidence-backed, human-reviewed leadership
-- recommendations. The engine RECOMMENDS; leadership DECIDES. Nothing here
-- auto-executes an employment, MOU, recruitment or hiring action.
-- (Scoped to the engine's own enums/tables; pre-existing db-push drift for
--  unrelated tables is intentionally not folded into this migration.)

-- CreateEnum
CREATE TYPE "DecisionType" AS ENUM ('recruitment', 'staff_addition', 'partner', 'staff_hr', 'regional_investment');

-- CreateEnum
CREATE TYPE "DecisionScopeType" AS ENUM ('country', 'region', 'district', 'sub_county', 'cluster', 'school', 'staff', 'partner');

-- CreateEnum
CREATE TYPE "DecisionRiskLevel" AS ENUM ('low', 'medium', 'high', 'critical');

-- CreateEnum
CREATE TYPE "DecisionConfidenceLevel" AS ENUM ('high', 'medium', 'low', 'insufficient');

-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('new', 'under_review', 'accepted', 'accepted_with_conditions', 'rejected', 'deferred', 'converted_to_action_plan');

-- CreateTable
CREATE TABLE "LeadershipDecisionInsight" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "quarter" TEXT,
    "decisionType" "DecisionType" NOT NULL,
    "scopeType" "DecisionScopeType" NOT NULL,
    "scopeId" TEXT,
    "scopeName" TEXT,
    "recommendation" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "riskLevel" "DecisionRiskLevel" NOT NULL,
    "confidenceLevel" "DecisionConfidenceLevel" NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "evidenceSummary" JSONB,
    "contextAdjustment" TEXT,
    "financialImplication" TEXT,
    "suggestedAction" TEXT NOT NULL,
    "alternatives" JSONB,
    "metrics" JSONB,
    "riskFlags" TEXT[],
    "status" "DecisionStatus" NOT NULL DEFAULT 'new',
    "reviewedByUserId" TEXT,
    "reviewedByRole" "EdifyRole",
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadershipDecisionInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionEvidencePoint" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "metricName" TEXT NOT NULL,
    "metricValue" TEXT NOT NULL,
    "comparisonValue" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "explanation" TEXT,
    "weight" TEXT NOT NULL DEFAULT 'supporting',
    "tone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionEvidencePoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionNote" (
    "id" TEXT NOT NULL,
    "insightId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "authorRole" "EdifyRole" NOT NULL,
    "note" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'note',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DecisionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffContextProfile" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "quarter" TEXT NOT NULL DEFAULT 'FY',
    "schoolLoad" INTEGER NOT NULL DEFAULT 0,
    "clientSchoolLoad" INTEGER NOT NULL DEFAULT 0,
    "coreSchoolLoad" INTEGER NOT NULL DEFAULT 0,
    "partnerManagementLoad" INTEGER NOT NULL DEFAULT 0,
    "projectLoad" INTEGER NOT NULL DEFAULT 0,
    "districtSpread" INTEGER NOT NULL DEFAULT 0,
    "subCountySpread" INTEGER NOT NULL DEFAULT 0,
    "rescheduleLoad" INTEGER NOT NULL DEFAULT 0,
    "evidenceBacklog" INTEGER NOT NULL DEFAULT 0,
    "geographyDifficulty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ruralityScore" DOUBLE PRECISION,
    "distanceBurden" DOUBLE PRECISION,
    "teamContributionScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "contextDifficultyScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffContextProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerPerformanceProfile" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "quarter" TEXT NOT NULL DEFAULT 'FY',
    "assignedActivities" INTEGER NOT NULL DEFAULT 0,
    "completedActivities" INTEGER NOT NULL DEFAULT 0,
    "targetAchievementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "evidenceAcceptanceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "iaConfirmationRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "returnedEvidenceCount" INTEGER NOT NULL DEFAULT 0,
    "rescheduleRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "overdueRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "capacityUtilization" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interventionImpactScore" DOUBLE PRECISION,
    "assignedInterventions" TEXT[],
    "recommendationStatus" TEXT,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerPerformanceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecruitmentReadinessProfile" (
    "id" TEXT NOT NULL,
    "scopeType" "DecisionScopeType" NOT NULL,
    "scopeId" TEXT NOT NULL DEFAULT '',
    "scopeName" TEXT,
    "fy" TEXT NOT NULL,
    "quarter" TEXT NOT NULL DEFAULT 'FY',
    "ssaCompletionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "targetAchievementRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "staffCapacityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "partnerCapacityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dataQualityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "impactScore" DOUBLE PRECISION,
    "schoolsTotal" INTEGER NOT NULL DEFAULT 0,
    "schoolsMissingSsa" INTEGER NOT NULL DEFAULT 0,
    "schoolsUnclustered" INTEGER NOT NULL DEFAULT 0,
    "recruitmentRecommendation" TEXT,
    "dataConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecruitmentReadinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadershipDecisionInsight_fy_decisionType_idx" ON "LeadershipDecisionInsight"("fy", "decisionType");
CREATE INDEX "LeadershipDecisionInsight_scopeType_scopeId_idx" ON "LeadershipDecisionInsight"("scopeType", "scopeId");
CREATE INDEX "LeadershipDecisionInsight_status_idx" ON "LeadershipDecisionInsight"("status");
CREATE INDEX "LeadershipDecisionInsight_riskLevel_idx" ON "LeadershipDecisionInsight"("riskLevel");
CREATE INDEX "LeadershipDecisionInsight_confidenceLevel_idx" ON "LeadershipDecisionInsight"("confidenceLevel");
CREATE INDEX "DecisionEvidencePoint_insightId_idx" ON "DecisionEvidencePoint"("insightId");
CREATE INDEX "DecisionNote_insightId_idx" ON "DecisionNote"("insightId");
CREATE INDEX "StaffContextProfile_fy_idx" ON "StaffContextProfile"("fy");
CREATE UNIQUE INDEX "StaffContextProfile_staffId_fy_quarter_key" ON "StaffContextProfile"("staffId", "fy", "quarter");
CREATE INDEX "PartnerPerformanceProfile_fy_idx" ON "PartnerPerformanceProfile"("fy");
CREATE UNIQUE INDEX "PartnerPerformanceProfile_partnerId_fy_quarter_key" ON "PartnerPerformanceProfile"("partnerId", "fy", "quarter");
CREATE INDEX "RecruitmentReadinessProfile_fy_idx" ON "RecruitmentReadinessProfile"("fy");
CREATE UNIQUE INDEX "RecruitmentReadinessProfile_scopeType_scopeId_fy_quarter_key" ON "RecruitmentReadinessProfile"("scopeType", "scopeId", "fy", "quarter");

-- AddForeignKey
ALTER TABLE "DecisionEvidencePoint" ADD CONSTRAINT "DecisionEvidencePoint_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "LeadershipDecisionInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DecisionNote" ADD CONSTRAINT "DecisionNote_insightId_fkey" FOREIGN KEY ("insightId") REFERENCES "LeadershipDecisionInsight"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffContextProfile" ADD CONSTRAINT "StaffContextProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerPerformanceProfile" ADD CONSTRAINT "PartnerPerformanceProfile_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
