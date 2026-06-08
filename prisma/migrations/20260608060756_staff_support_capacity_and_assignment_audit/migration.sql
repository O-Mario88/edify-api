-- CreateTable
CREATE TABLE "StaffSupportCapacity" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "maxDirectSchoolsSupported" INTEGER NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "setByRole" "EdifyRole" NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffSupportCapacity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignmentAudit" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "schoolId" TEXT,
    "activityId" TEXT,
    "assignerId" TEXT NOT NULL,
    "assignerRole" "EdifyRole" NOT NULL,
    "assignedToType" TEXT NOT NULL,
    "assignedStaffId" TEXT,
    "assignedPartnerId" TEXT,
    "allowed" BOOLEAN NOT NULL,
    "blockedReason" TEXT,
    "overrideUsed" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignmentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StaffSupportCapacity_fy_idx" ON "StaffSupportCapacity"("fy");

-- CreateIndex
CREATE UNIQUE INDEX "StaffSupportCapacity_staffId_fy_key" ON "StaffSupportCapacity"("staffId", "fy");

-- CreateIndex
CREATE INDEX "AssignmentAudit_assignerId_idx" ON "AssignmentAudit"("assignerId");

-- CreateIndex
CREATE INDEX "AssignmentAudit_schoolId_idx" ON "AssignmentAudit"("schoolId");

-- CreateIndex
CREATE INDEX "AssignmentAudit_createdAt_idx" ON "AssignmentAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "StaffSupportCapacity" ADD CONSTRAINT "StaffSupportCapacity_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "StaffProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
