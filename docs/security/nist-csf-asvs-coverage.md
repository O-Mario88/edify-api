# NIST CSF 2.0 / OWASP ASVS Coverage Matrix

How the implemented controls map to the governance framework (NIST CSF 2.0) and the application baseline (OWASP ASVS / Top 10). Status: ✅ implemented · 🟡 partial / seam · ⏳ backlog.

## NIST CSF 2.0

### Govern
| Control | Status | Where |
|---|---|---|
| Security policy + role policies | ✅ | `role-permission-matrix.md`, `ROLE_PERMISSIONS` |
| Data protection policy + classification | ✅ | `data-classification-matrix.md` + `data-classification.ts` |
| Approval / audit rules | ✅ | payment gate + audit-log-policy |
| Secure deployment governance | ✅ | `prod:check` gates + `secure-deployment-checklist.md` |
| Vendor/processor records | 🟡 | retention/DPPA notes |

### Identify
| Classify data | ✅ | classification registry |
| Map users/roles/permissions | ✅ | RBAC matrix + ScopeService |
| Sensitive records + evidence/file risk | ✅ | evidence policy + upload design |
| Financial-workflow + third-party risk | ✅ | payment gate, partner identity |

### Protect
| AuthN (hash, sessions, lockout, MFA) | ✅ / 🟡 | JWT+bcrypt, lockout+rate-limit ✅; MFA seam 🟡 |
| AuthZ (RBAC + object-level) | ✅ | `AuthorizationService` (3-layer) |
| Encryption in transit / at rest | ✅ / 🟡 | HSTS + TLS; field-crypto (AES-256-GCM) for restricted fields |
| Secure file upload + preview | ✅ | magic-byte validation, quarantine, nosniff/sandbox |
| API validation, rate limiting, secure DB | ✅ | ValidationPipe, RateLimitGuard, Prisma least-privilege |
| Secrets management | ✅ | env-validated, gitignored, secret-manager-sourced |

### Detect
| Audit logs (immutable) | ✅ | hash-chain + append-only trigger |
| Suspicious-access / failed-login / anomaly | ✅ / 🟡 | authz denies + login-failure audit + dashboard; alert delivery ⏳ |
| Evidence-tamper / payment anomaly | ✅ | quarantine + payment-integrity invariants |

### Respond
| Incident workflow | ✅ | `incident-response-plan.md` |
| Account lock / token revoke / quarantine | ✅ / 🟡 | lockout + isActive + secret-rotation; per-user revoke ⏳ |
| Admin alerts | 🟡 | dashboard alerts; push delivery ⏳ |

### Recover
| Backups + restore testing | ✅ | `backup.sh` + `restore-test.sh` (proven) |
| Disaster recovery + audit reconstruction | ✅ | `backup-recovery-plan.md` + `audit:verify` |

## OWASP Top 10 (2021)

| # | Risk | Status | Control |
|---|---|---|---|
| A01 | Broken Access Control | ✅ | object-level authz, IDOR fixes, evidence row-scope |
| A02 | Cryptographic Failures | ✅ | bcrypt, AES-256-GCM field-crypto, HSTS/TLS |
| A03 | Injection | ✅ | Prisma parameterization, DTO validation, no raw SQL in app |
| A04 | Insecure Design | ✅ | zero-trust workflow gates, shadow-first authz rollout |
| A05 | Security Misconfiguration | ✅ | prod-readiness gate, security headers, helmet, env rails |
| A06 | Vulnerable Components | 🟡 | lockfiles committed; `npm audit` in CI ⏳ |
| A07 | Auth Failures | ✅ / 🟡 | lockout + rate-limit + strong JWT; MFA seam 🟡 |
| A08 | Integrity Failures | ✅ | audit hash-chain + append-only; ID edit-locks |
| A09 | Logging/Monitoring Failures | ✅ | comprehensive append-only audit + dashboard |
| A10 | SSRF | ✅ | no user-controlled outbound URLs; evidence proxied server-side only |

## ASVS themes

Access control (V1/V4) ✅ · Authentication (V2) ✅/🟡 · Session (V3) ✅ · Validation/encoding (V5) ✅ · Cryptography (V6) ✅ · Error handling + logging (V7) ✅ · Data protection (V8) ✅ · Files/resources (V12) ✅ · Configuration (V14) ✅.

## Open items (tracked)

CI dep-scan + SAST + secret-scan (A06) · MFA enrolment (A07) · alert delivery + per-user token revocation (Respond) · retention worker · Nest e2e + Playwright security tests.
