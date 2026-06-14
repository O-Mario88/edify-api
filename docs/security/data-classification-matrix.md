# Data Classification Matrix

Every model carries a sensitivity level (spec §2). The machine-readable source of truth is `src/common/data-classification.ts` (`DATA_CLASSIFICATION`); this doc is the human view. Classification drives: who can read it (authz), whether it is encrypted at rest (field-crypto), retention, and export rules.

## Levels

| Level | Meaning | Examples |
|---|---|---|
| **Public** | No harm if disclosed | Generic program descriptions, non-sensitive settings |
| **Internal** | Staff-only, low sensitivity | Dashboards, aggregate counts, geography, cost catalogue, targets |
| **Confidential** | Operational, role-scoped | School directory + contacts, staff/partner records, SSA scores, planning, clusters, daily debriefs, messages |
| **Restricted** | Tightly controlled | Evidence files, attendance/visit forms, meeting minutes, Salesforce/Netsuite IDs, fund requests, payment/accountability, donor reports (pre-approval), staff performance notes |
| **Highly Restricted** | Secrets | Password hashes, MFA secrets, reset tokens, API keys, storage signing keys, DB credentials, audit-integrity keys |

## Model → classification (summary)

| Model(s) | Level | Encrypt-at-rest fields |
|---|---|---|
| User | Restricted (auth secrets are Highly Restricted) | `mfaSecret`, `passwordResetTokenHash` (+ `passwordHash` is bcrypt) |
| AuditLog | Restricted (integrity-critical, append-only + hash-chained) | — |
| EvidenceRecord, PaymentDisbursement, PaymentActionLog, ActivityCompletionVerification, Report | Restricted | — |
| PaymentRequest | Restricted | `netsuiteExpenseId` |
| FundRequest | Restricted | `accountabilityNetsuiteId` |
| School | Confidential (contacts Restricted) | — (contact fields flagged restricted) |
| StaffProfile, Partner, SsaRecord, Activity, Cluster, DailyDebrief, Message, Notification | Confidential | Partner `email`/`phone` flagged |
| CostSetting, Region, District, SubCounty, Parish, Target | Internal | — |

## Controls by level

- **Highly Restricted / Restricted secrets** — never returned by any API, never logged, never exported; secrets in the secret manager, the encrypt-at-rest fields via `field-crypto` (AES-256-GCM).
- **Restricted operational** (evidence/payment/IDs) — object-level authorized on every read (authz matrix), audited, payment-pipeline-scoped for the accountant, edit-locked after confirmation.
- **Confidential** — role + object scope (ScopeService); never public; export role-gated.
- **Internal** — authenticated staff; aggregates only for summary roles (RVP/CD).
- **Public** — unauthenticated allowed.

## Using the registry

```ts
import { classificationOf, fieldsToEncrypt } from 'src/common/data-classification';
classificationOf('PaymentRequest').level;   // 'restricted'
fieldsToEncrypt();   // [{model:'User',field:'mfaSecret'}, {model:'PaymentRequest',field:'netsuiteExpenseId'}, ...]
```

Keep this doc and the registry in lock-step when models change.
