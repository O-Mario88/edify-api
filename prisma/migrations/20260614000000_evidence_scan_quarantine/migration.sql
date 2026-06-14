-- Evidence malware-scan + quarantine fields (security Phase 2, spec §11).
-- Additive only; existing rows default to a 'pending' scan and not quarantined.
ALTER TABLE "EvidenceRecord" ADD COLUMN "scanStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "EvidenceRecord" ADD COLUMN "quarantined" BOOLEAN NOT NULL DEFAULT false;

-- Index for the "quarantined files" security-dashboard query.
CREATE INDEX "EvidenceRecord_quarantined_idx" ON "EvidenceRecord"("quarantined");
