# Data Retention Policy

Retention by data type (spec §20). Principle: keep what audit/donor/finance obligations require, delete the rest on a schedule, and **never** casually delete audit-critical history.

| Data | Retention | Mechanism |
|---|---|---|
| **Audit logs** | Long-term (≥ 7 years / finance-audit horizon) | Append-only (DB trigger) + daily NDJSON export; never app-deletable |
| **Evidence files** | Contract/donor/audit period (default 7 years) | Retained on the evidence volume + backups |
| **Payment / accountability records** | Finance-audit period (≥ 7 years) | Retained; edit-locked after confirmation |
| **Daily debriefs** | Operational period (e.g. 2 years) then archive | Scheduled archive job (backlog) |
| **SSA / planning / activities** | Programme lifetime | Soft-delete (`deletedAt`), excluded from active workflow |
| **Archived schools** | Retained, hidden from active workflow | `deletedAt` / archived status |
| **Temporary uploads (rejected/in-flight)** | Deleted immediately | `EvidenceService.discard` on validation/scan failure |
| **Incomplete drafts** | Purge after policy period (e.g. 90 days) | Scheduled purge job (backlog) |
| **Password-reset tokens** | Until use or expiry (short, e.g. 30 min) | `passwordResetExpires`; cleared on use |
| **Sessions / JWTs** | Access token TTL (12h); no server store | Stateless; revoke via secret rotation |

## Deletion rules

- **Soft-delete** (`deletedAt`) is the default for operational records so history and referential integrity survive; hard deletion is reserved and never applied to audit/payment/evidence-verification records.
- The audit append-only trigger makes silent deletion of payment/evidence/verification history **impossible** through the application — a legally-mandated purge is a privileged, logged migration, not a code path.

## Backlog (jobs to add)

A scheduled retention worker to: archive debriefs past their operational window, purge abandoned drafts and expired reset tokens, and prune temporary artifacts. Until then, the immediate `discard` of rejected uploads + the short reset-token expiry are the active controls.

## Data Protection (Uganda DPPA)

Personal data (school/staff/partner contacts) is collected for a stated operational purpose (purpose limitation), minimized to workflow need (data minimization — see §19 form review), access-controlled by role + scope, retained per the above, and breach-handled per the incident-response plan. A privacy notice + data-subject-request process are documented controls to formalize before processing personal data at scale.
