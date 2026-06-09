#!/bin/sh
set -e

# Apply pending migrations before the app boots. Idempotent — no-op when the
# database is already up to date.
echo "[entrypoint] applying database migrations…"
npx prisma migrate deploy

# Optionally seed on first boot (guarded inside the seed; safe to re-run).
if [ "$RUN_SEED" = "true" ]; then
  echo "[entrypoint] seeding…"
  npx prisma db seed || echo "[entrypoint] seed skipped/failed (non-fatal)"
fi

echo "[entrypoint] starting: $*"
exec "$@"
