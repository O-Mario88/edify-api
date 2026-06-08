-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityStatus" ADD VALUE 'cancelled';
ALTER TYPE "ActivityStatus" ADD VALUE 'deferred';

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN     "lastReason" TEXT,
ADD COLUMN     "rescheduleCount" INTEGER NOT NULL DEFAULT 0;
