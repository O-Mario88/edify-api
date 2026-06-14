# Audit Log Policy

Edify keeps an **append-only, tamper-evident** audit trail so every sensitive action can be proven after the fact: *who did it, to what, from where, when, did it succeed, and was the record altered since?*

## What is recorded

Each `AuditLog` row carries: `seq` (monotonic), `action`, `subjectKind`/`subjectId`, `actorId`/`actorRole`, `success`, `reason`, `payload`, `ipAddress`, `userAgent`, `correlationId`, `createdAt`, and the chain fields `prevHash`/`hash`. Provenance (ip/ua/correlationId) is captured automatically via an AsyncLocalStorage request context (`src/common/context/request-context.ts`) — no call site threads it through.

## Tamper resistance

- **Hash chain.** `hash = sha256(prevHash + canonical(record))`, where `canonical` is a deterministic (sorted-key) serialization of the business fields (`src/common/audit/audit-hash.ts`). Each row's `prevHash` is the previous row's `hash`. Altering any past row's content breaks its own hash; altering the link breaks every subsequent row. Appends are serialized by a Postgres advisory lock so the chain is strictly linear under concurrency.
- **Append-only at the database.** A trigger (`edify_audit_append_only`) raises on any `UPDATE` or `DELETE` of `AuditLog`, so neither the application connection nor a normal admin can rewrite or erase history. (Proven: `UPDATE`/`DELETE` both rejected.)
- **Verification.** `npm run audit:verify` (and `AuditService.verifyChain()`, surfaced on the security dashboard) walks the chain and reports the first break with its `seq`.
- **Daily export.** `npm run audit:export -- <YYYY-MM-DD>` writes the day's rows as NDJSON (mode 600) to `AUDIT_EXPORT_DIR` for encrypted offsite retention.

## Actions audited

Authentication (`auth.login`; login-failure + lockout in Phase 8) · activity lifecycle (`activity.create/reschedule/reassign/cancel/defer`) · IA verification (`authz.allow.sensitive` verify) · payment (`authz.allow.sensitive` pay) · evidence (`evidence.upload/accept/return/quarantine`, `authz.allow.sensitive` download) · **every authorization denial** (`authz.deny` / `authz.deny.shadow`) and **every sensitive allow** (pay/verify/approve/export/download). Remaining spec items (role/permission change, school owner-reassign, SSA correct, Salesforce/Netsuite entry, fund approve/return, report/data export) are emitted as those workflows route through the central engine; coverage is tracked in the NIST/ASVS matrix.

## Retention

Audit logs are retained **long-term** (finance/donor/contract audit horizon) and are **never** casually deleted (the DB trigger enforces this). Purge, if ever legally required, is a privileged, logged migration that temporarily disables the trigger — not an application path.

## Resilience

Audit writes never break the primary action: a failure to write is logged and swallowed (`AuditService.log` try/catch). The trade-off is deliberate — an action proceeding without its audit row is preferable to a user-facing failure, and write failures are themselves surfaced in server logs + the dashboard.
