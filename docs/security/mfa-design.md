# MFA Design (TOTP)

Multi-factor authentication for high-risk roles. **Design + DB seam shipped; enrolment/verification UI is the build-out step** (the seam is in place so it can land without a migration).

## Who must use MFA (spec §5)

Required: **Admin, CountryDirector, ImpactAssessment, ProgramAccountant, RegionalVicePresident, HumanResources**, and anyone with export / payment / access-control permission. Partner MFA optional at first, supported.

## DB seam (already migrated)

`User.mfaEnabled: boolean` + `User.mfaSecret: string?` (migration `20260614020000_auth_hardening`). The secret is stored **encrypted at rest** via `field-crypto` (`encryptField` on enrol, `decryptField` on verify) — it is Highly Restricted and never returned by any API.

## Flow

1. **Enrol** — server generates a TOTP secret (RFC 6238, e.g. via `otplib`), stores `encryptField(secret)`, returns an `otpauth://` URI for a QR. User confirms one code → `mfaEnabled = true`. Provide one-time recovery codes (store only hashes).
2. **Login (2-step)** — password verifies (existing `AuthService` + lockout + rate-limit), then if `mfaEnabled`, the access token is withheld until a valid TOTP code (±1 step skew) is submitted. Failed TOTP counts toward lockout.
3. **Enforcement** — a required-role user without `mfaEnabled` is allowed a short grace to enrol, then blocked from privileged actions until enrolled (policy gate in the auth flow).
4. **Reset/disable** — Admin-only, audited (`auth.mfa.reset`).

## Audit

`auth.mfa.enrolled`, `auth.mfa.challenge.failed`, `auth.mfa.reset` — all flow through the append-only audit log; MFA adoption % is already surfaced on the security dashboard (`authentication.mfaAdoption`).

## Why not built fully now

Enrolment needs a TOTP library (+ a small UI) and changes the login UX; per the agreed scope it is delivered as design + seam. The lockout, rate-limit, audit, and dashboard plumbing it depends on are already live, so enrolment is an additive, low-risk follow-up.
