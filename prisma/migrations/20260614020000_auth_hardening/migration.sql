-- Auth hardening (security Phase 8): account lockout + MFA seam + reset seam.
ALTER TABLE "User" ADD COLUMN "failedLoginCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "lockedUntil" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "mfaEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "mfaSecret" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordResetExpires" TIMESTAMP(3);
