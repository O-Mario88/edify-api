-- Explicit cluster meeting-slot identity on activities
CREATE TYPE "ClusterMeetingSlot" AS ENUM ('sit', 'first_meeting', 'second_meeting', 'third_meeting');
ALTER TABLE "Activity" ADD COLUMN "clusterSlot" "ClusterMeetingSlot";
