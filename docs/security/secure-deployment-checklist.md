# Secure Deployment Checklist

Run before every production deploy. Two automated gates do most of this; the rest is manual confirmation.

## Automated gates (block the deploy)

```bash
# Backend (edify-api) — evaluates the deploy environment AS production.
npm run prod:check          # mock off, dev endpoints off, strong JWT_SECRET,
                            # AUTHZ_MODE=enforce, EVIDENCE_STORAGE_DIR writable

# Frontend (edify-web)
npm run prod:check          # NEXT_PUBLIC_USE_MOCK_DATA off, EDIFY_USE_BACKEND on,
                            # no page route imports frontend mock
```

Both read the **deploy environment's** variables (CI / Railway secrets), so run them in that environment. Exit non-zero = do not deploy. The backend gate reuses `validateEnv` (the same rails that fail-fast at boot), so the gate and the runtime guard can never drift.

## Production environment (must all be true)

- [ ] `NODE_ENV=production`
- [ ] `ENABLE_MOCK_DATA=false`, `ENABLE_DEV_ENDPOINTS=false`
- [ ] `JWT_SECRET` — strong, ≥16 chars, not a dev value, **separate from staging/dev**
- [ ] `AUTHZ_MODE=enforce` (object-level authorization blocking, not shadow)
- [ ] `PARTNER_ROLE_BRIDGE=false` once real User↔Partner linkage exists
- [ ] `EVIDENCE_STORAGE_DIR` → a persistent, **non-public** volume, writable
- [ ] `CORS_ORIGINS` → the exact frontend origin(s), no wildcard
- [ ] `DATABASE_URL` → the production DB, least-privilege app user (not superuser)
- [ ] `NEXT_PUBLIC_USE_MOCK_DATA=false`, `EDIFY_USE_BACKEND=true`
- [ ] Secrets come from the secret manager, not committed files (`.env` gitignored — Phase 9)

## Database

- [ ] Migrations applied: `npm run prisma:deploy` (incl. `evidence_scan_quarantine`, `audit_chain_append_only`)
- [ ] Audit append-only trigger present (`audit_no_update` / `audit_no_delete`)
- [ ] Audit chain verifies: `npm run audit:verify`
- [ ] No integrity violations: `GET /api/system-health` returns 0 errors

## Known not-yet-green

- **Frontend mock-leakage gate is currently RED**: page routes still import frontend mock (the in-progress backend-only purge). Production does **not** render mock — `mock-policy.isMockAllowed()` returns false in production regardless — but the stricter "zero page imports" goal is not yet met. Track to zero before relying on the FE gate as a hard block; until then treat the runtime `mock-policy` guard as the control and the gate as a burn-down metric.

## Post-deploy smoke

- [ ] Security headers present on a page response (CSP/HSTS/nosniff/frame)
- [ ] An evidence download requires auth + scope (out-of-scope → 403/404)
- [ ] A payment cannot clear before IA confirmation (system-health invariant = 0)
- [ ] Admin-only `/admin/security` dashboard reachable by Admin, blocked for others
