-- CreateEnum
CREATE TYPE "EdifyRole" AS ENUM ('CCEO', 'CountryProgramLead', 'CountryDirector', 'RegionalVicePresident', 'ImpactAssessment', 'ProgramAccountant', 'HumanResources', 'ProjectCoordinator', 'PartnerAdmin', 'PartnerFieldOfficer', 'Admin');

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('client', 'core', 'potential_core', 'other');

-- CreateEnum
CREATE TYPE "AccountOwnerStatus" AS ENUM ('matched', 'unmatched', 'pending');

-- CreateEnum
CREATE TYPE "DuplicateStatus" AS ENUM ('none', 'potential', 'confirmed', 'not_duplicate', 'merged');

-- CreateEnum
CREATE TYPE "ClusterStatus" AS ENUM ('unclustered', 'clustered', 'needs_review');

-- CreateEnum
CREATE TYPE "SsaStatus" AS ENUM ('not_done', 'scheduled', 'partner_assigned', 'done');

-- CreateEnum
CREATE TYPE "PlanningReadiness" AS ENUM ('locked', 'limited', 'ready');

-- CreateEnum
CREATE TYPE "SsaIntervention" AS ENUM ('teaching_and_learning', 'financial_health', 'christlike_behaviour', 'exposure_to_word_of_god', 'government_requirements', 'leadership', 'education_technology', 'learning_environment');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('school_visit', 'follow_up_visit', 'coaching_visit', 'in_school_support', 'training', 'school_improvement_training', 'cluster_meeting', 'cluster_training', 'ssa_activity', 'project_activity', 'partner_activity', 'core_visit', 'core_training');

-- CreateEnum
CREATE TYPE "DeliveryType" AS ENUM ('staff', 'partner');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('not_planned', 'planned', 'scheduled', 'assigned_to_partner', 'partner_scheduled', 'in_progress', 'evidence_uploaded', 'evidence_accepted', 'salesforce_id_required', 'awaiting_ia_verification', 'ia_verified', 'accountant_confirmed', 'completed', 'returned', 'rejected', 'rescheduled');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('none', 'uploaded', 'accepted', 'returned', 'rejected');

-- CreateEnum
CREATE TYPE "EvidenceKind" AS ENUM ('visit_form', 'school_stamp', 'attendance_form', 'meeting_minutes', 'resolutions', 'evaluation_form', 'assessment_form', 'photo', 'pdf', 'project_report', 'coaching_notes');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('pending', 'confirmed', 'returned', 'flagged');

-- CreateEnum
CREATE TYPE "SalesforceActivityType" AS ENUM ('visit', 'training');

-- CreateEnum
CREATE TYPE "SalesforceSyncStatus" AS ENUM ('not_synced', 'pending', 'synced', 'error');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('none', 'pending_ia', 'ia_confirmed', 'pl_approval_required', 'pl_approved', 'accountant_cleared', 'paid', 'netsuite_accountability', 'closed', 'rejected');

-- CreateEnum
CREATE TYPE "PaymentPath" AS ENUM ('partner', 'staff');

-- CreateEnum
CREATE TYPE "ProjectCategory" AS ENUM ('intervention_specific', 'pilot', 'selective_limited');

-- CreateEnum
CREATE TYPE "NotificationPriority" AS ENUM ('low', 'normal', 'high', 'urgent');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('unread', 'read', 'archived');

-- CreateEnum
CREATE TYPE "BudgetView" AS ENUM ('summary', 'detailed');

-- CreateEnum
CREATE TYPE "StaffOnboardingState" AS ENUM ('pending', 'active', 'suspended');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "roles" "EdifyRole"[],
    "activeRole" "EdifyRole" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RolePermission" (
    "id" TEXT NOT NULL,
    "role" "EdifyRole" NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RolePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffNumber" TEXT,
    "title" TEXT,
    "primaryDistrictId" TEXT,
    "onboardingState" "StaffOnboardingState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSupervisorAssignment" (
    "id" TEXT NOT NULL,
    "superviseeId" TEXT NOT NULL,
    "supervisorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSupervisorAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffGeographyAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "regionId" TEXT,
    "districtId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffGeographyAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffSchoolAssignment" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSchoolAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffTargetProfile" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "visitsTarget" INTEGER NOT NULL DEFAULT 0,
    "trainingsTarget" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffTargetProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "regionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubCounty" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubCounty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Parish" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subCountyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Parish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "subCountyId" TEXT,
    "parishId" TEXT,
    "shippingAddress" TEXT,
    "schoolPhone" TEXT,
    "primaryContactName" TEXT,
    "primaryContactPhone" TEXT,
    "enrollment" INTEGER,
    "schoolType" "SchoolType" NOT NULL DEFAULT 'client',
    "accountOwnerId" TEXT,
    "accountOwnerNameRaw" TEXT,
    "accountOwnerStatus" "AccountOwnerStatus" NOT NULL DEFAULT 'pending',
    "duplicateStatus" "DuplicateStatus" NOT NULL DEFAULT 'none',
    "clusterId" TEXT,
    "clusterStatus" "ClusterStatus" NOT NULL DEFAULT 'unclustered',
    "currentFySsaStatus" "SsaStatus" NOT NULL DEFAULT 'not_done',
    "planningReadiness" "PlanningReadiness" NOT NULL DEFAULT 'locked',
    "salesforceAccountId" TEXT,
    "salesforceSyncStatus" "SalesforceSyncStatus" NOT NULL DEFAULT 'not_synced',
    "salesforceLastSyncedAt" TIMESTAMP(3),
    "salesforceSyncError" TEXT,
    "createdByIa" BOOLEAN NOT NULL DEFAULT false,
    "uploadBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadBatch" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "fileName" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "flaggedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UploadBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAccountOwnerUploadMap" (
    "id" TEXT NOT NULL,
    "uploadBatchId" TEXT NOT NULL,
    "schoolIdRaw" TEXT NOT NULL,
    "ownerNameRaw" TEXT NOT NULL,
    "matchedStaffId" TEXT,
    "matched" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolAccountOwnerUploadMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolDuplicateCandidate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "reasons" TEXT[],
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolDuplicateCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cluster" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "subCountyName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Cluster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolClusterAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "clusterId" TEXT NOT NULL,
    "assignedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolClusterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsaRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "dateOfSsa" TIMESTAMP(3) NOT NULL,
    "fy" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "newEnrollment" INTEGER,
    "averageScore" DOUBLE PRECISION,
    "salesforceId" TEXT,
    "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "uploadedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SsaRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SsaScore" (
    "id" TEXT NOT NULL,
    "ssaRecordId" TEXT NOT NULL,
    "intervention" "SsaIntervention" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "SsaScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolEnrollmentHistory" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "enrollment" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SchoolEnrollmentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "schoolId" TEXT,
    "clusterId" TEXT,
    "projectId" TEXT,
    "fy" TEXT NOT NULL,
    "quarter" TEXT NOT NULL,
    "month" INTEGER,
    "week" INTEGER,
    "scheduledDate" TIMESTAMP(3),
    "plannedMonth" INTEGER,
    "plannedWeek" INTEGER,
    "responsibleStaffId" TEXT,
    "monitoredByStaffId" TEXT,
    "assignedPartnerId" TEXT,
    "deliveryType" "DeliveryType" NOT NULL DEFAULT 'staff',
    "purposeIntervention" "SsaIntervention",
    "status" "ActivityStatus" NOT NULL DEFAULT 'not_planned',
    "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'none',
    "salesforceActivityId" TEXT,
    "salesforceActivityType" "SalesforceActivityType",
    "iaVerificationStatus" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "iaConfirmedAt" TIMESTAMP(3),
    "iaConfirmedBy" TEXT,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'none',
    "teachersAttended" INTEGER,
    "leadersAttended" INTEGER,
    "otherParticipants" INTEGER,
    "nextMeetingDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "kind" "EvidenceKind" NOT NULL,
    "uri" TEXT NOT NULL,
    "notes" TEXT,
    "uploadedBy" TEXT NOT NULL,
    "status" "EvidenceStatus" NOT NULL DEFAULT 'uploaded',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityCompletionVerification" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "salesforceId" TEXT NOT NULL,
    "enteredBy" TEXT NOT NULL,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "VerificationStatus" NOT NULL DEFAULT 'pending',
    "iaActorId" TEXT,
    "iaActionAt" TIMESTAMP(3),
    "iaNote" TEXT,

    CONSTRAINT "ActivityCompletionVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentRequest" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "path" "PaymentPath" NOT NULL,
    "amount" DOUBLE PRECISION,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending_ia',
    "netsuiteExpenseId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentActionLog" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentActionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentDisbursement" (
    "id" TEXT NOT NULL,
    "paymentRequestId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "clearedBy" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,

    CONSTRAINT "PaymentDisbursement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualPlan" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "ownerStaffId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualPlanActivity" (
    "id" TEXT NOT NULL,
    "annualPlanId" TEXT NOT NULL,
    "activityType" "ActivityType" NOT NULL,
    "schoolId" TEXT,
    "clusterId" TEXT,
    "quarter" TEXT NOT NULL,
    "month" INTEGER,
    "week" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnnualPlanActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBudgetLine" (
    "id" TEXT NOT NULL,
    "annualPlanActivityId" TEXT NOT NULL,
    "costSettingKey" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityBudgetLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetVersion" (
    "id" TEXT NOT NULL,
    "annualPlanId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetApproval" (
    "id" TEXT NOT NULL,
    "budgetVersionId" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BudgetApproval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyFundRequest" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "staffId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MonthlyFundRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unitCost" DOUBLE PRECISION NOT NULL,
    "fy" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CostSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProjectCategory" NOT NULL,
    "intervention" "SsaIntervention",
    "managerStaffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSchoolAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSchoolAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectPartnerAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectPartnerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectImpactSnapshot" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "metricsJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectImpactSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "regionName" TEXT,
    "trainsOn" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "contextType" TEXT,
    "contextId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'unread',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "contextType" TEXT,
    "contextId" TEXT,
    "targetRoute" TEXT,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "priority" "NotificationPriority" NOT NULL DEFAULT 'normal',
    "status" "MessageStatus" NOT NULL DEFAULT 'unread',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "subjectKind" TEXT,
    "subjectId" TEXT,
    "actorId" TEXT,
    "actorRole" "EdifyRole",
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_key_key" ON "Permission"("key");

-- CreateIndex
CREATE UNIQUE INDEX "RolePermission_role_permissionId_key" ON "RolePermission"("role", "permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_userId_key" ON "StaffProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffProfile_staffNumber_key" ON "StaffProfile"("staffNumber");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSupervisorAssignment_superviseeId_supervisorId_key" ON "StaffSupervisorAssignment"("superviseeId", "supervisorId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSchoolAssignment_staffId_schoolId_key" ON "StaffSchoolAssignment"("staffId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffTargetProfile_staffId_fy_key" ON "StaffTargetProfile"("staffId", "fy");

-- CreateIndex
CREATE UNIQUE INDEX "Region_name_key" ON "Region"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE UNIQUE INDEX "District_regionId_name_key" ON "District"("regionId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "SubCounty_districtId_name_key" ON "SubCounty"("districtId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Parish_subCountyId_name_key" ON "Parish"("subCountyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "School_schoolId_key" ON "School"("schoolId");

-- CreateIndex
CREATE INDEX "School_regionId_idx" ON "School"("regionId");

-- CreateIndex
CREATE INDEX "School_districtId_idx" ON "School"("districtId");

-- CreateIndex
CREATE INDEX "School_clusterId_idx" ON "School"("clusterId");

-- CreateIndex
CREATE INDEX "School_schoolType_idx" ON "School"("schoolType");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolDuplicateCandidate_schoolId_candidateId_key" ON "SchoolDuplicateCandidate"("schoolId", "candidateId");

-- CreateIndex
CREATE INDEX "Cluster_districtId_idx" ON "Cluster"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolClusterAssignment_schoolId_clusterId_key" ON "SchoolClusterAssignment"("schoolId", "clusterId");

-- CreateIndex
CREATE INDEX "SsaRecord_schoolId_idx" ON "SsaRecord"("schoolId");

-- CreateIndex
CREATE INDEX "SsaRecord_fy_idx" ON "SsaRecord"("fy");

-- CreateIndex
CREATE UNIQUE INDEX "SsaScore_ssaRecordId_intervention_key" ON "SsaScore"("ssaRecordId", "intervention");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolEnrollmentHistory_schoolId_fy_key" ON "SchoolEnrollmentHistory"("schoolId", "fy");

-- CreateIndex
CREATE INDEX "Activity_schoolId_idx" ON "Activity"("schoolId");

-- CreateIndex
CREATE INDEX "Activity_clusterId_idx" ON "Activity"("clusterId");

-- CreateIndex
CREATE INDEX "Activity_fy_quarter_idx" ON "Activity"("fy", "quarter");

-- CreateIndex
CREATE INDEX "Activity_responsibleStaffId_idx" ON "Activity"("responsibleStaffId");

-- CreateIndex
CREATE INDEX "Activity_status_idx" ON "Activity"("status");

-- CreateIndex
CREATE INDEX "EvidenceRecord_activityId_idx" ON "EvidenceRecord"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityCompletionVerification_activityId_key" ON "ActivityCompletionVerification"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentRequest_activityId_key" ON "PaymentRequest"("activityId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentDisbursement_paymentRequestId_key" ON "PaymentDisbursement"("paymentRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualPlan_fy_ownerStaffId_key" ON "AnnualPlan"("fy", "ownerStaffId");

-- CreateIndex
CREATE UNIQUE INDEX "CostSetting_key_key" ON "CostSetting"("key");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSchoolAssignment_projectId_schoolId_key" ON "ProjectSchoolAssignment"("projectId", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPartnerAssignment_projectId_partnerId_key" ON "ProjectPartnerAssignment"("projectId", "partnerId");

-- CreateIndex
CREATE INDEX "Notification_recipientId_status_idx" ON "Notification"("recipientId", "status");

-- CreateIndex
CREATE INDEX "AuditLog_subjectKind_subjectId_idx" ON "AuditLog"("subjectKind", "subjectId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_idx" ON "AuditLog"("actorId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "RolePermission" ADD CONSTRAINT "RolePermission_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "Permission"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffProfile" ADD CONSTRAINT "StaffProfile_primaryDistrictId_fkey" FOREIGN KEY ("primaryDistrictId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSupervisorAssignment" ADD CONSTRAINT "StaffSupervisorAssignment_superviseeId_fkey" FOREIGN KEY ("superviseeId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSupervisorAssignment" ADD CONSTRAINT "StaffSupervisorAssignment_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGeographyAssignment" ADD CONSTRAINT "StaffGeographyAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGeographyAssignment" ADD CONSTRAINT "StaffGeographyAssignment_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffGeographyAssignment" ADD CONSTRAINT "StaffGeographyAssignment_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSchoolAssignment" ADD CONSTRAINT "StaffSchoolAssignment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffSchoolAssignment" ADD CONSTRAINT "StaffSchoolAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffTargetProfile" ADD CONSTRAINT "StaffTargetProfile_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "District" ADD CONSTRAINT "District_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubCounty" ADD CONSTRAINT "SubCounty_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Parish" ADD CONSTRAINT "Parish_subCountyId_fkey" FOREIGN KEY ("subCountyId") REFERENCES "SubCounty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_subCountyId_fkey" FOREIGN KEY ("subCountyId") REFERENCES "SubCounty"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_parishId_fkey" FOREIGN KEY ("parishId") REFERENCES "Parish"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_accountOwnerId_fkey" FOREIGN KEY ("accountOwnerId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "School" ADD CONSTRAINT "School_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAccountOwnerUploadMap" ADD CONSTRAINT "SchoolAccountOwnerUploadMap_uploadBatchId_fkey" FOREIGN KEY ("uploadBatchId") REFERENCES "UploadBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolDuplicateCandidate" ADD CONSTRAINT "SchoolDuplicateCandidate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolDuplicateCandidate" ADD CONSTRAINT "SchoolDuplicateCandidate_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cluster" ADD CONSTRAINT "Cluster_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClusterAssignment" ADD CONSTRAINT "SchoolClusterAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolClusterAssignment" ADD CONSTRAINT "SchoolClusterAssignment_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsaRecord" ADD CONSTRAINT "SsaRecord_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SsaScore" ADD CONSTRAINT "SsaScore_ssaRecordId_fkey" FOREIGN KEY ("ssaRecordId") REFERENCES "SsaRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolEnrollmentHistory" ADD CONSTRAINT "SchoolEnrollmentHistory_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_clusterId_fkey" FOREIGN KEY ("clusterId") REFERENCES "Cluster"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_responsibleStaffId_fkey" FOREIGN KEY ("responsibleStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_monitoredByStaffId_fkey" FOREIGN KEY ("monitoredByStaffId") REFERENCES "StaffProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_assignedPartnerId_fkey" FOREIGN KEY ("assignedPartnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityCompletionVerification" ADD CONSTRAINT "ActivityCompletionVerification_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentRequest" ADD CONSTRAINT "PaymentRequest_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentActionLog" ADD CONSTRAINT "PaymentActionLog_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentDisbursement" ADD CONSTRAINT "PaymentDisbursement_paymentRequestId_fkey" FOREIGN KEY ("paymentRequestId") REFERENCES "PaymentRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnnualPlanActivity" ADD CONSTRAINT "AnnualPlanActivity_annualPlanId_fkey" FOREIGN KEY ("annualPlanId") REFERENCES "AnnualPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBudgetLine" ADD CONSTRAINT "ActivityBudgetLine_annualPlanActivityId_fkey" FOREIGN KEY ("annualPlanActivityId") REFERENCES "AnnualPlanActivity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetVersion" ADD CONSTRAINT "BudgetVersion_annualPlanId_fkey" FOREIGN KEY ("annualPlanId") REFERENCES "AnnualPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetApproval" ADD CONSTRAINT "BudgetApproval_budgetVersionId_fkey" FOREIGN KEY ("budgetVersionId") REFERENCES "BudgetVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSchoolAssignment" ADD CONSTRAINT "ProjectSchoolAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSchoolAssignment" ADD CONSTRAINT "ProjectSchoolAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPartnerAssignment" ADD CONSTRAINT "ProjectPartnerAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectPartnerAssignment" ADD CONSTRAINT "ProjectPartnerAssignment_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectImpactSnapshot" ADD CONSTRAINT "ProjectImpactSnapshot_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
