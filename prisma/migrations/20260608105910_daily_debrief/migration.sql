-- CreateEnum
CREATE TYPE "DebriefType" AS ENUM ('staff', 'partner', 'merged');

-- CreateEnum
CREATE TYPE "DebriefStatus" AS ENUM ('draft', 'submitted', 'reviewed', 'merged', 'returned', 'archived');

-- CreateTable
CREATE TABLE "DailyDebrief" (
    "id" TEXT NOT NULL,
    "fy" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "submittedByUserId" TEXT NOT NULL,
    "submittedByRole" "EdifyRole" NOT NULL,
    "staffId" TEXT,
    "partnerId" TEXT,
    "debriefType" "DebriefType" NOT NULL DEFAULT 'staff',
    "status" "DebriefStatus" NOT NULL DEFAULT 'submitted',
    "summary" TEXT,
    "whatHappened" TEXT,
    "whatWentWell" TEXT,
    "whatDidNotGoWell" TEXT,
    "blockers" TEXT[],
    "blockerOther" TEXT,
    "supportNeeded" TEXT,
    "recommendations" TEXT,
    "nextAction" TEXT,
    "linkedSchoolIds" TEXT[],
    "linkedClusterIds" TEXT[],
    "linkedPartnerIds" TEXT[],
    "linkedProjectIds" TEXT[],
    "linkedActivityIds" TEXT[],
    "parentDebriefId" TEXT,
    "mergedIntoDebriefId" TEXT,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "DailyDebrief_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyDebriefRecipient" (
    "id" TEXT NOT NULL,
    "debriefId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "recipientRole" "EdifyRole" NOT NULL,
    "routingReason" TEXT,
    "actionRequired" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyDebriefRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyDebrief_fy_date_idx" ON "DailyDebrief"("fy", "date");

-- CreateIndex
CREATE INDEX "DailyDebrief_submittedByUserId_idx" ON "DailyDebrief"("submittedByUserId");

-- CreateIndex
CREATE INDEX "DailyDebrief_status_idx" ON "DailyDebrief"("status");

-- CreateIndex
CREATE INDEX "DailyDebrief_partnerId_idx" ON "DailyDebrief"("partnerId");

-- CreateIndex
CREATE INDEX "DailyDebriefRecipient_recipientUserId_readAt_idx" ON "DailyDebriefRecipient"("recipientUserId", "readAt");

-- CreateIndex
CREATE INDEX "DailyDebriefRecipient_debriefId_idx" ON "DailyDebriefRecipient"("debriefId");

-- AddForeignKey
ALTER TABLE "DailyDebriefRecipient" ADD CONSTRAINT "DailyDebriefRecipient_debriefId_fkey" FOREIGN KEY ("debriefId") REFERENCES "DailyDebrief"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
