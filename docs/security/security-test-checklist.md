# Security Test Checklist

The spec's §32 cases mapped to automated coverage. ✅ = covered by an automated test today; 🔎 = verified at runtime this build; ⏳ = backlog.

## Access control

- ✅ CCEO cannot access another CCEO's school — `authorization.service.spec.ts`
- ✅ Partner cannot access the School Directory — same
- ✅ Accountant cannot read raw evidence outside the payment pipeline — same
- ✅ CD cannot reach the operational School Directory — same
- ✅ IA cannot clear a payment — same
- ✅ Partner cannot approve own evidence (no self-review) — same
- ✅ Payment before IA confirmation blocked — same (+ `clearPayment` business gate)
- ✅ Evidence download outside scope blocked — same
- ✅ Partner-activity IDOR closed — same
- ✅ Unauthenticated API access blocked — `JwtAuthGuard` on every controller; 🔎 `/security/health` 403 without token/role

## File upload

- ✅ Executable blocked (`.exe`, ELF-as-pdf) — `file-validation.spec.ts`
- ✅ SVG/HTML/script blocked — same
- ✅ Content/extension mismatch blocked — same
- ✅ Filename sanitized (traversal, header injection) — same
- 🔎 Oversized (>10MB) rejected by multer limit
- ⏳ Malware scan rejects EICAR (once a real `EvidenceScanner` is bound)

## Injection / input

- ✅ Invalid Salesforce ID rejected — `salesforce-id.util.spec.ts` + `complete()` gate
- ✅ DTO validation (whitelist) strips/blocks unexpected input — `ValidationPipe`
- 🔎 SQL-injection-style input is parameterized (Prisma) — no string SQL in app paths
- ⏳ XSS payload escaping — FE render is React-escaped; evidence served with nosniff+sandbox CSP

## Auth / abuse

- ✅ Rate-limit works — `rate-limit.spec.ts`; 🔎 login 429s after 10/min
- 🔎 Account lockout after N failures — runtime (1→2→3→4→lock@5 → 403)
- 🔎 Login failures audited — `auth.login.failed` / `.lockout`
- ✅ CSRF (FE) — double-submit cookie in middleware

## Integrity / crypto

- ✅ Audit hash-chain tamper detection — `audit-hash.spec.ts`; 🔎 chain verify + UPDATE/DELETE blocked
- ✅ Field encryption round-trip + tamper detection — `field-crypto.spec.ts`
- 🔎 Append-only audit (DB trigger) — UPDATE/DELETE rejected
- 🔎 Backup restore-test integrity assertions pass

## Deployment

- 🔎 Prod-readiness gate fails on unsafe env — `npm run prod:check` (both repos)
- 🔎 Security headers present (CSP/HSTS/nosniff/frame) on FE responses

## Run

```bash
cd edify-api && npm run typecheck && npm test    # 58 tests
cd edify-web && npm run typecheck && npm test
```

Backlog: a Nest e2e suite (`supertest`) for live HTTP authz/role smoke tests, and FE Playwright for the header + middleware-redirect checks.
