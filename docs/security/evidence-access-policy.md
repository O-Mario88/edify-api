# Evidence Access Policy

Evidence files are **Restricted** data (visit/attendance forms, meeting minutes, photos, reports). They are never public and are reachable only through an authenticated, authorized, audited endpoint.

## Principles

1. **No public URLs.** Files are served by `GET /evidence/:id/file` (backend) and, for the browser, the Next proxy `/api/evidence/[id]/file`. There is no direct, guessable, or signed-public link.
2. **Authorized per object.** Every view/download authorizes the **caller against the parent activity** — `AuthorizationService` `evidence:download`. Closes the prior hole where any `PLANNING_VIEW` holder could stream any file by id.
3. **Least privilege by role.** The accountant — though country-scoped — may only read evidence for partner activities **in the payment pipeline** (`ia_confirmed`/`pl_approved`/`accountant_cleared`/`paid`), never the program's raw evidence at large.
4. **Quarantine wins.** A `quarantined` record (failed malware scan) is never served — returns 404.
5. **Defanged delivery.** Responses carry `X-Content-Type-Options: nosniff`, a restrictive `Content-Security-Policy` (`default-src 'none'; img-src 'self' data:; object-src 'none'; sandbox`), `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: no-referrer`, `Cache-Control: private, no-store`, and `Content-Disposition` `inline` only for image/PDF (everything else `attachment`). The same headers are re-applied by the Next proxy.
6. **Audited.** Every download is a sensitive action → `authz.allow.sensitive` (kind `evidence`, action `download`). Upload, accept, return, reject, and quarantine are audited too.

## Who can access what

| Role | Evidence access |
|---|---|
| CCEO / PL | Files for activities on schools in their portfolio (own ∪ supervised). |
| IA | Country-wide (verification role). |
| ProjectCoordinator | Files for their project schools. |
| ProgramAccountant | Only partner activities in the payment pipeline. |
| Partner | Only their own assigned activities' evidence. |
| CD / RVP / HR | No raw evidence (analytics/people surfaces only). |

## Review (accept / return / reject)

- Gated on `EVIDENCE_REVIEW` + parent activity in scope.
- **No self-review:** a reviewer can never accept/return evidence they uploaded (`uploadedBy = self` → denied), even with the permission. This keeps "partner cannot approve own evidence" and "staff cannot sign off their own file" true by construction.
- A return/reject requires a reason (audited).

## Lifecycle states

`uploaded → accepted | returned | rejected`; `quarantined` (scan) is orthogonal and blocks serving. `Activity.evidenceStatus` mirrors the review outcome and gates the IA → payment workflow (`evidence-access-policy` ties into the payment gate — see `role-permission-matrix.md`).
