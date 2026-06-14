# Edify Security Documentation

Data security, privacy, access-control & evidence-protection for the Edify Planning & Monitoring platform. Governance: **NIST CSF 2.0**; application baseline: **OWASP ASVS / Top 10**; privacy: **Uganda Data Protection & Privacy Act**.

Security model: *authenticate every user, authorize every object, validate every action, encrypt every sensitive path, audit every important change, verify every payment before money moves* — built into workflows, enforced server-side (the backend is the source of truth; frontend hiding is never the control).

## Documents

| Doc | What it covers |
|---|---|
| [role-permission-matrix.md](role-permission-matrix.md) | RBAC + object-level authorization (the resource×action matrix) |
| [data-classification-matrix.md](data-classification-matrix.md) | Sensitivity levels per model + encrypt-at-rest fields |
| [file-upload-security-design.md](file-upload-security-design.md) | Secure evidence upload (magic-byte validation, quarantine, scan seam) |
| [evidence-access-policy.md](evidence-access-policy.md) | Evidence download/preview authorization + hardening |
| [audit-log-policy.md](audit-log-policy.md) | Append-only, hash-chained audit trail |
| [secure-deployment-checklist.md](secure-deployment-checklist.md) | Pre-deploy gates + production env requirements |
| [backup-recovery-plan.md](backup-recovery-plan.md) | Backups, RPO/RTO, restore testing, DR |
| [mfa-design.md](mfa-design.md) | TOTP MFA design + DB seam |
| [incident-response-plan.md](incident-response-plan.md) | Detect → contain → recover → review |
| [data-retention-policy.md](data-retention-policy.md) | Retention by data type + DPPA notes |
| [security-test-checklist.md](security-test-checklist.md) | §32 test cases → automated coverage |
| [nist-csf-asvs-coverage.md](nist-csf-asvs-coverage.md) | Framework coverage matrix + open items |

## Key tooling

```bash
npm run prod:check      # production-readiness gate (both repos)
npm run audit:verify    # verify the audit hash chain
npm run audit:export -- YYYY-MM-DD   # daily immutable audit export
./scripts/backup.sh     # encrypted DB + evidence backup
./scripts/restore-test.sh  # prove a backup restores + is intact
```

Admin-only live posture: **`/admin/security`** (frontend) ← `GET /api/security/health` (SYSTEM_ADMIN).

## Implementation map (backend `src/`)

`common/authz/*` object-level authorization · `common/rbac/*` RBAC · `common/scope/*` data scope · `common/audit/*` hash-chained audit · `common/context/*` request provenance · `common/crypto/field-crypto.ts` field encryption · `common/security/rate-limit.ts` throttle · `common/filters/all-exceptions.filter.ts` safe errors · `modules/evidence/*` secure files · `modules/security/*` dashboard · `config/env.validation.ts` prod rails.
