# Edify Planning & Monitoring Tool — Backend

> **Priority:** the backend foundation for a NestJS + PostgreSQL + Prisma Planning
> and Monitoring Tool. **School Directory is the source of truth.** Manual school
> upload comes first. Salesforce integration is future work (1–2 years out), but
> the backend is **Salesforce-ready from day one**. Mock data is kept for
> development/testing but isolated so it can be disabled before deployment.
> Modules are strict, role-gated, and workflow-connected — not disconnected CRUD.

## Stack

- **NestJS** (modular, DI, guards, REST-first)
- **PostgreSQL + Prisma** (typed data access, migrations, soft delete)
- **JWT auth** + **role/permission matrix** + **access-scope engine**
- **Redis + BullMQ** — scaffolded, gated off by default (`ENABLE_BACKGROUND_JOBS=false`)
- Swagger docs at `/api/docs` (non-production)

## Run it

```bash
# 1. Postgres (Homebrew)
brew services start postgresql@16
createdb edify_pm

# 2. Install + configure
npm install
cp .env.example .env          # adjust DATABASE_URL / JWT_SECRET

# 3. Migrate + seed
npm run prisma:migrate        # applies migrations
npm run seed                  # reference data always; mock data if ENABLE_MOCK_DATA=true

# 4. Boot
npm run start:dev             # http://localhost:4000/api  (docs: /api/docs)
```

### Demo logins (mock data, password `edify`)

`admin@edify.org` · `cd@edify.org` (Country Director) · `ia@edify.org` (Impact
Assessment) · `pl@edify.org` · `cceo@edify.org` · `accountant@edify.org`.

```bash
curl -s localhost:4000/api/health
TOKEN=$(curl -s -X POST localhost:4000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"cd@edify.org","password":"edify"}' | jq -r .accessToken)
curl -s localhost:4000/api/auth/me        -H "Authorization: Bearer $TOKEN"   # scope
curl -s localhost:4000/api/schools        -H "Authorization: Bearer $TOKEN"   # scoped, paginated
curl -s localhost:4000/api/system-health  -H "Authorization: Bearer $TOKEN"
```

## What exists now (foundation — verified running)

| Area | Status |
|---|---|
| NestJS + Prisma + Postgres wiring, env validation, prod safety rails | ✅ |
| **Salesforce-ready Prisma schema** — all major domains, SV-/TS- fields, sync fields, soft delete, FY/quarter, audit | ✅ migrated |
| Auth (JWT login + `/me`), role→permission matrix, `PermissionsGuard` | ✅ |
| **Access-scope engine** (`resolveUserScope`) — country/region/district/cluster/school/staff/partner + capability flags | ✅ |
| FY utilities (Oct–Sep, quarters, mid-year, cumulative target %) | ✅ |
| Geography module (ID-based regions/districts/sub-counties) | ✅ seeded |
| **Schools** — manual single + bulk upload, validation, duplicate detection (flag-not-block), account-owner mapping, planning-readiness compute, scoped+paginated reads, duplicate resolution | ✅ |
| Audit logging service | ✅ |
| System-health checks (missing owner/cluster/SSA, unmatched owners, dupes, staff gaps, mock-in-prod) | ✅ |
| Mock-data isolation (`ENABLE_MOCK_DATA`, blocked in production) | ✅ |

### Verified end-to-end
Public health → DB up · CD login → 17 permissions · scope: country=true · CD sees
**3** schools, CCEO sees **2** (scope gating) · accountant `POST /schools` → **403**
(permission gating) · system-health flags missing clusters/SSA/supervisor.

## Roadmap (next modules — schema already supports them)

In implementation order (§31): **users/staff** (+ supervisor/onboarding), **clusters**
(assignment + recommendations), **ssa** (IA upload, 8 interventions, readiness),
**planning** (gap lists), **activities** (generic), **evidence** (review/accept/return),
**salesforce-verification** (manual SV-/TS- + IA confirm), **payments** (partner/staff
paths), **annual-plan-budget** (cost settings → budget), **special-projects**,
**messages/notifications** (context-linked), **analytics** (scoped summaries),
**reports/export**. BullMQ jobs wire in once Redis is enabled.

## Production deployment rails

`NODE_ENV=production` enforces: `ENABLE_MOCK_DATA=false`, `ENABLE_DEV_ENDPOINTS=false`,
a strong `JWT_SECRET`, no Swagger. `ENABLE_SALESFORCE_INTEGRATION=false` until the
real integration is built — the SV-/TS- entry + IA-confirmation workflow is the seam.
