# Deploying edify-api to Fly.io

The edify-web frontend's data layer (the ~96 bridge surfaces) is **server-side
proxied to edify-api**. Until edify-api is deployed, the live edify-web dashboards
return 502 (it points at `localhost:4000`). This deploys edify-api and wires
edify-web to it.

> I (Claude) can't run these from here — there's no `fly`/`docker` CLI or Fly auth
> in the session. Run them on your machine (with `flyctl` installed + `fly auth login`).
> Everything edify-api needs to deploy is now in the repo: `Dockerfile`, `fly.toml`,
> `docker-entrypoint.sh` (auto-runs `prisma migrate deploy`), and a gated prod seed.

## 1. Create the app + database + evidence volume

```bash
cd "edify-api"
fly apps create edify-api                      # or pick a unique name; update app= in fly.toml
# Match edify-web's region (find it: fly status -a <edify-web-app>); set primary_region in fly.toml
fly postgres create --name edify-api-db --region <region>   # or attach an existing PG / Supabase
fly postgres attach edify-api-db -a edify-api  # sets DATABASE_URL secret automatically
fly volumes create edify_api_data --region <region> --size 1   # for EVIDENCE_STORAGE_DIR=/data/evidence
```

## 2. Set secrets (required — prod env-validation fails the boot without these)

```bash
fly secrets set -a edify-api \
  JWT_SECRET="$(openssl rand -hex 32)" \
  DEMO_LOGIN_PASSWORD="<choose-one>"          # MUST match edify-web's DEMO_LOGIN_PASSWORD (step 5)
# AUTHZ_MODE=enforce, NODE_ENV=production, PORT, EVIDENCE_STORAGE_DIR are already in fly.toml [env].
# Optional: ENABLE_DEMO_ADMIN=true (only if you want the generic admin@edify.org account).
```

## 3. Deploy

```bash
fly deploy -a edify-api
# release_command runs `prisma migrate deploy`; the entrypoint re-runs it on boot.
fly status -a edify-api          # health check hits GET /api/health → should be "passing"
```

## 4. Seed demo data into the prod DB (so the FE has accounts + content)

The prod seed withholds demo data by default. For a demo / online-test deployment,
seed it explicitly. ts-node isn't in the runtime image, so seed from your machine
against the prod DB over a Fly proxy:

```bash
# Terminal A — tunnel the Fly Postgres to localhost:5432
fly proxy 5432 -a edify-api-db
# Terminal B — seed (DATABASE_URL = the Fly PG connection string; password from `fly postgres` output)
cd "edify-api"
DATABASE_URL="postgresql://postgres:<pwd>@localhost:5432/edify_api?sslmode=disable" \
  NODE_ENV=production ALLOW_DEMO_SEED_IN_PROD=true DEMO_LOGIN_PASSWORD="<same-as-step-2>" \
  npx prisma db seed
```

This seeds the 10 demo users (so the edify-web bridge can authenticate) + schools +
operational data. Re-runnable (it purges operational tables first, keeps users/reference).

## 5. Point edify-web at the deployed edify-api, then redeploy edify-web

```bash
fly secrets set -a <edify-web-app> \
  EDIFY_USE_BACKEND=true \
  EDIFY_API_URL="https://edify-api.fly.dev/api" \
  DEMO_LOGIN_PASSWORD="<same-as-step-2>"
# (edify-web also needs, from the identity work: EDIFY_SESSION_SECRET, SUPER_ADMIN_PASSWORD,
#  SECURITY_ENCRYPTION_KEY — see edify-web docs/security-identity-platform-2026-06-19.md)
fly deploy -a <edify-web-app>
```

**More secure alternative (no public edify-api):** drop `[http_service]` from
`fly.toml`, keep `min_machines_running >= 1`, and set
`EDIFY_API_URL=http://edify-api.internal:4000/api` (Fly private networking, same org).

## 6. Verify

```bash
curl https://edify-api.fly.dev/api/health        # {"status":"ok","db":"up"}
```
Then open the live edify-web, sign in, and confirm dashboards show live data
(the "Live · scoped" badges) — the 502s should be gone.

## Notes
- **DEMO_LOGIN_PASSWORD must match** on edify-api (seed hashes users with it) and
  edify-web (the bridge logs in with it). A mismatch = the bridge can't authenticate
  = 502s.
- The longer-term goal is to retire edify-api by reimplementing its surfaces on
  edify-web's own Prisma (see edify-web memory). This deploy is the interim backend
  so the live FE works now.
