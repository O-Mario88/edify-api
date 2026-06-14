# Incident Response Plan

A practical playbook for security incidents on Edify (spec §33). Roles: **Security Owner** (Admin), **Technical Lead**, **CD** (operational risk).

## Incident types

Account compromise · evidence file exposure · unauthorized school-data access · payment-workflow abuse · malware upload · data breach · lost admin credential · production secret leak.

## Lifecycle

1. **Detect** — sources: the security dashboard alerts (`/admin/security`), the append-only audit log (`authz.deny`, `auth.login.lockout`, `evidence.quarantine`, payment-integrity invariants), server error spikes (correlationId), failed restore tests. Daily `audit:verify` cron flags a broken chain.
2. **Triage** — classify severity (data sensitivity × scope × reversibility). A non-zero payment-integrity figure or a broken audit chain is **critical**.
3. **Contain** —
   - *Account compromise*: disable the account (`User.isActive=false`), force lockout (`lockedUntil`), revoke sessions (rotate `JWT_SECRET` → invalidates all tokens; or bump a per-user token version when added).
   - *Malware upload*: the file is already quarantined; confirm it was never downloaded (audit `authz.allow.sensitive` download for that evidence id).
   - *Secret leak*: rotate the leaked secret immediately (JWT/DB/storage/field-encryption key), redeploy, and re-run the prod-readiness gate.
   - *Evidence exposure*: quarantine the record(s), audit the access trail, revoke.
4. **Preserve** — the audit log is append-only and hash-chained; export the relevant window (`audit:export`) for forensics before any remediation that changes state.
5. **Eradicate & recover** — patch the cause; restore from a verified backup if data was destroyed (`restore-test` proves recoverability); verify `system-health` = 0 errors and `audit:verify` OK.
6. **Notify** — leadership per severity; data-subject/regulator notification per the Uganda Data Protection & Privacy Act timelines if personal data was breached (assess affected records from the audit trail).
7. **Post-incident review** — blameless: timeline (reconstructed from correlationIds + audit), root cause, what detection/control would have caught it earlier, action items with owners.

## Emergency controls available today

| Need | Action |
|---|---|
| Lock an account | set `User.lockedUntil` / `isActive=false` |
| Revoke all sessions | rotate `JWT_SECRET` + redeploy |
| Quarantine evidence | set `EvidenceRecord.quarantined=true` (becomes un-downloadable) |
| Stop a leaked secret | rotate in secret manager, redeploy, `npm run prod:check` |
| Prove integrity | `npm run audit:verify` |
| Recover data | restore from `backup.sh` artifact, `restore-test.sh` to validate |

## Follow-ups (automation backlog)

Wire dashboard alerts → email/Slack/PagerDuty (Phase 11), a per-user token-version for instant single-account revocation, and an in-app "disable account / quarantine" admin action.
