-- Audit tamper-resistance (security Phase 3, spec §16/§17):
-- hash-chain + provenance columns, and a DB-level append-only guard.

-- Provenance + outcome + chain columns (additive).
ALTER TABLE "AuditLog" ADD COLUMN "seq" BIGSERIAL NOT NULL;
ALTER TABLE "AuditLog" ADD COLUMN "ipAddress" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "userAgent" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "correlationId" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "success" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "AuditLog" ADD COLUMN "reason" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "prevHash" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN "hash" TEXT;

CREATE INDEX "AuditLog_seq_idx" ON "AuditLog"("seq");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_correlationId_idx" ON "AuditLog"("correlationId");

-- Append-only: block UPDATE and DELETE at the database so neither the
-- application connection nor a normal admin can silently rewrite or erase
-- payment / evidence / verification history. (DROP TABLE is unaffected, so
-- migrations + dev resets still work; only row mutation is denied.)
CREATE OR REPLACE FUNCTION edify_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only — % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_no_update ON "AuditLog";
DROP TRIGGER IF EXISTS audit_no_delete ON "AuditLog";
CREATE TRIGGER audit_no_update BEFORE UPDATE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION edify_audit_append_only();
CREATE TRIGGER audit_no_delete BEFORE DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION edify_audit_append_only();
