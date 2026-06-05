-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "actionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "contextId" TEXT,
ADD COLUMN     "contextType" TEXT,
ADD COLUMN     "priority" "NotificationPriority" NOT NULL DEFAULT 'normal',
ADD COLUMN     "recipientId" TEXT,
ADD COLUMN     "targetRoute" TEXT;

-- CreateIndex
CREATE INDEX "Message_recipientId_status_idx" ON "Message"("recipientId", "status");
