# Role Permission & Object-Access Matrix

Authoritative reference for **who can do what** in Edify. Two layers, both enforced server-side:

1. **Route RBAC** (`src/common/rbac/*`) — `@RequirePermissions(...)` + `PermissionsGuard`. Answers *"may this ROLE call this endpoint?"*. The role→permission matrix is `ROLE_PERMISSIONS` in `src/common/rbac/permissions.ts`.
2. **Object-level authorization** (`src/common/authz/*`) — `AuthorizationService.canAccessResource(user, ref, action)`. Answers *"may this USER take this ACTION on this specific OBJECT, in its current workflow stage?"* — ownership, supervision, partner-linkage, project assignment, geography, stage.

> Frontend hiding is never the control. Every sensitive action calls layer 2.

## 1. Roles → key permissions

| Role | Directory | Plan/Assign | Evidence review | IA verify | Pay | Budget approve | Staff (HR) | Partner mgmt | Export |
|---|---|---|---|---|---|---|---|---|---|
| **Admin** | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **CountryDirector** | ✗ (analytics only) | assign ✓ | ✓ | ✗ | ✗ | ✗ | ✓ | ✓ | ✓ |
| **RegionalVicePresident** | ✗ (summary only) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |
| **CountryProgramLead** | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | view | ✓ |
| **CCEO** | ✓ | ✓ | ✓ | ✗ | ✗ | ✓ | ✗ | view | ✗ |
| **ImpactAssessment** | ✓ | view | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | ✓ |
| **ProgramAccountant** | ✗ | view | ✗ | ✗ | ✓ | ✗ | ✗ | ✗ | ✓ |
| **HumanResources** | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✓ | ✗ | ✗ |
| **ProjectCoordinator** | ✓ (project schools) | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ | view | ✗ |
| **PartnerAdmin / PartnerFieldOfficer** | ✗ | own assigned work | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ |

Source of truth: `ROLE_PERMISSIONS`. "Directory ✗" is the literal absence of `SCHOOL_DIRECTORY_VIEW` — that is how *CD/Accountant/HR/RVP/Partner cannot reach the operational School Directory*.

## 2. Object-level decision = 3 short-circuit layers

For `canAccessResource(user, {kind, id?, loadedEntity?}, action)`:

1. **Role permission** — `PERMISSION_MAP[kind:action]` must be in the user's permissions, else `missing-permission:*`.
2. **Object scope** — ownership / partner / supervision / geography from `UserScope`. `countryScope` (CD/IA/Accountant/Admin) and Admin bypass **layer 2 geography only**.
3. **Workflow stage** — e.g. `pay` requires IA-confirmed; `verify` requires `awaiting_ia_verification`. Applies to **everyone**, including Admin.

### Resource × action rules

| Resource | Action | Layer-1 perm | Layer-2 scope | Layer-3 stage |
|---|---|---|---|---|
| school | view/update | `SCHOOL_DIRECTORY_VIEW`/`SCHOOL_EDIT` | country bypass; else `school.id ∈ scope.schoolIds`; ProjectCoordinator → project schools | — |
| activity | update/schedule | `ACTIVITY_COMPLETE` | partner → `assignedPartnerId ∈ partnerIds` **and** `deliveryType='partner'`; else `schoolId ∈ schoolIds` **or** `responsibleStaffId ∈ staff/supervised` | — |
| activity | assign | `ACTIVITY_ASSIGN` | as update (+ `AssignmentService` capacity) | — |
| activity | verify (IA confirm) | `IA_VERIFY` | country (IA) | `status='awaiting_ia_verification'` |
| payment | pay | `PAYMENT_ACT` | country (Accountant) | `deliveryType='partner'` ∧ `iaVerificationStatus='confirmed'` ∧ Salesforce ID ∧ `evidenceStatus='accepted'` ∧ not already paid |
| evidence | upload | `ACTIVITY_COMPLETE` | uploader owns/delivers parent activity | — |
| evidence | verify (review) | `EVIDENCE_REVIEW` | parent activity in scope; **never `uploadedBy = self`** | — |
| evidence | download/view | `PLANNING_VIEW` | parent activity in scope; **Accountant → only partner activities in the payment pipeline** | not quarantined/deleted (Phase 2) |
| ssa | view/upload | `SSA_VIEW`/`SSA_UPLOAD` | country bypass; else `schoolId ∈ schoolIds` | — |
| fundRequest | approve | `BUDGET_APPROVE` | originating staff ∈ `supervisedStaffIds` (CCEO/PL chain) | pending |
| partner | view | `PARTNER_VIEW` | partner user → own record only | — |
| project | view/assign | `PROJECT_MANAGE` | coordinator → assigned projects | — |
| staff | view/manage | `STAFF_MANAGE` | HR/Admin/CD | — |
| report | view/export | `ANALYTICS_VIEW`/`EXPORT` | aggregate; RVP/CD country counts, never rows | — |

## 3. Enforcement mode & audit

- `AUTHZ_MODE=shadow` (default) logs `authz.deny.shadow` without throwing — used to roll out across endpoints and catch false denials against real flows before blocking. `AUTHZ_MODE=enforce` throws `ForbiddenException`. **Production must run `enforce`** (asserted in `env.validation.ts`).
- Every deny is audited (`authz.deny[.shadow]`); every **sensitive** allow (`pay`, `verify`, `approve`, `export`, `download`) is audited (`authz.allow.sensitive`).
- The payment gate also lives as explicit, friendly checks in `ActivitiesService.clearPayment` — defense-in-depth that is **always** enforcing, independent of `AUTHZ_MODE`.

## 4. The required negative cases (proven in `authorization.service.spec.ts`)

CCEO ∉ another CCEO's school · partner ∉ directory · accountant ∉ raw evidence outside payment scope · CD ∉ operational directory · IA ∉ pay · partner ∉ approve-own-evidence · pay-before-IA blocked · evidence-download-out-of-scope blocked · partner-activity IDOR closed · self-review blocked. Plus positive sanity + shadow/enforce behaviour. **18 tests green.**
