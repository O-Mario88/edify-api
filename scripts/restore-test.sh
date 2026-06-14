#!/usr/bin/env bash
# Restore-test (security Phase 6, spec §22 "test restore monthly"). Restores the
# latest DB dump into a DISPOSABLE scratch database, runs integrity assertions,
# then drops it. Never touches the source database. Exit non-zero on any failure.
#
#   ADMIN_DATABASE_URL=postgres://user@host/postgres \
#   BACKUP_DIR=/backups  [DUMP_FILE=/backups/edify-db-XXXX.dump] \
#   ./scripts/restore-test.sh
#
# ADMIN_DATABASE_URL must point at a maintenance DB (e.g. "postgres") on the same
# server with rights to CREATE/DROP DATABASE. Encrypted dumps must be decrypted
# to a plaintext .dump first (see backup-recovery-plan.md).
set -euo pipefail

: "${ADMIN_DATABASE_URL:?set ADMIN_DATABASE_URL (a maintenance DB with create/drop rights)}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
SCRATCH_DB="${SCRATCH_DB:-edify_restore_test}"

DUMP_FILE="${DUMP_FILE:-$(ls -t "$BACKUP_DIR"/edify-db-*.dump 2>/dev/null | head -1 || true)}"
if [ -z "${DUMP_FILE:-}" ] || [ ! -f "$DUMP_FILE" ]; then
  echo "No plaintext dump found in $BACKUP_DIR (decrypt an .age/.gpg first, or set DUMP_FILE)." >&2
  exit 2
fi
echo "==> Restoring $DUMP_FILE into scratch DB '$SCRATCH_DB'"

# Build the scratch DB connection URL by swapping the path component.
SCRATCH_URL="$(printf '%s' "$ADMIN_DATABASE_URL" | sed -E "s#/[^/?]+(\?|$)#/$SCRATCH_DB\1#")"

cleanup() {
  psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=0 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";" >/dev/null 2>&1 || true
}
trap cleanup EXIT

psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS \"$SCRATCH_DB\";"
psql "$ADMIN_DATABASE_URL" -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$SCRATCH_DB\";"
pg_restore --no-owner --no-acl -d "$SCRATCH_URL" "$DUMP_FILE"

echo "==> Integrity assertions"
fail=0
assert() { # $1 = label, $2 = SQL returning a single number, $3 = test expr using $V
  local label="$1" sql="$2" expr="$3"
  local V
  V="$(psql "$SCRATCH_URL" -tA -c "$sql" | tr -d '[:space:]')"
  if eval "$expr"; then echo "  ✓ $label ($V)"; else echo "  ✗ $label ($V)"; fail=1; fi
}

assert "schools present"            "SELECT count(*) FROM \"School\";"     '[ "$V" -gt 0 ]'
assert "users present"              "SELECT count(*) FROM \"User\";"       '[ "$V" -gt 0 ]'
assert "audit log present"          "SELECT count(*) FROM \"AuditLog\";"   '[ "$V" -ge 0 ]'
# INVARIANT survives restore: no payment cleared/paid without IA confirmation.
assert "no payment bypassing IA"    "SELECT count(*) FROM \"Activity\" WHERE \"deletedAt\" IS NULL AND \"paymentStatus\" IN ('accountant_cleared','paid') AND \"iaVerificationStatus\" <> 'confirmed';" '[ "$V" -eq 0 ]'
# Append-only trigger survives the restore.
assert "audit append-only trigger"  "SELECT count(*) FROM pg_trigger WHERE tgname IN ('audit_no_update','audit_no_delete');" '[ "$V" -eq 2 ]'

if [ "$fail" -ne 0 ]; then
  echo "==> RESTORE TEST FAILED" >&2
  exit 1
fi
echo "==> Restore test PASSED — backup is recoverable and intact."
