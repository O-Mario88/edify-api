-- CD partner-onboarding profile fields
ALTER TABLE "Partner" ADD COLUMN "contactPerson" TEXT;
ALTER TABLE "Partner" ADD COLUMN "email" TEXT;
ALTER TABLE "Partner" ADD COLUMN "phone" TEXT;
ALTER TABLE "Partner" ADD COLUMN "coverageDistricts" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Partner" ADD COLUMN "contractStatus" TEXT;
ALTER TABLE "Partner" ADD COLUMN "onboardedByUserId" TEXT;
ALTER TABLE "Partner" ADD COLUMN "onboardedAt" TIMESTAMP(3);
