#!/usr/bin/env bash
# Encrypted backup of the Edify database + evidence files (security Phase 6).
#
#   DATABASE_URL=postgres://...  EVIDENCE_STORAGE_DIR=/data/evidence \
#   BACKUP_DIR=/backups  BACKUP_AGE_RECIPIENT=age1...  ./scripts/backup.sh
#
# Encryption is applied when an `age` recipient (BACKUP_AGE_RECIPIENT) or a GPG
# recipient (BACKUP_GPG_RECIPIENT) is configured; otherwise the backup is written
# unencrypted with a loud warning (never do this for production / offsite copies).
# Old backups beyond BACKUP_RETENTION_DAYS (default 30) are pruned.
set -euo pipefail

: "${DATABASE_URL:?set DATABASE_URL}"
BACKUP_DIR="${BACKUP_DIR:-backups}"
EVIDENCE_DIR="${EVIDENCE_STORAGE_DIR:-uploads/evidence}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
STAMP="${BACKUP_STAMP:?set BACKUP_STAMP=YYYYmmddTHHMMSSZ (cron supplies it; no time syscall here)}"

mkdir -p "$BACKUP_DIR"
DB_FILE="$BACKUP_DIR/edify-db-$STAMP.dump"
EV_FILE="$BACKUP_DIR/edify-evidence-$STAMP.tar.gz"

encrypt() { # $1 = plaintext file -> writes $1.age / $1.gpg, removes plaintext
  local f="$1"
  if command -v age >/dev/null 2>&1 && [ -n "${BACKUP_AGE_RECIPIENT:-}" ]; then
    age -r "$BACKUP_AGE_RECIPIENT" -o "$f.age" "$f" && rm -f "$f"
    echo "  encrypted -> $f.age"
  elif command -v gpg >/dev/null 2>&1 && [ -n "${BACKUP_GPG_RECIPIENT:-}" ]; then
    gpg --yes --batch -r "$BACKUP_GPG_RECIPIENT" -o "$f.gpg" -e "$f" && rm -f "$f"
    echo "  encrypted -> $f.gpg"
  else
    echo "  WARNING: no BACKUP_AGE_RECIPIENT/BACKUP_GPG_RECIPIENT — '$f' is UNENCRYPTED."
  fi
}

echo "==> Database dump (custom format, compressed)"
pg_dump "$DATABASE_URL" -Fc -f "$DB_FILE"
chmod 600 "$DB_FILE"
encrypt "$DB_FILE"

if [ -d "$EVIDENCE_DIR" ]; then
  echo "==> Evidence files: $EVIDENCE_DIR"
  tar -czf "$EV_FILE" -C "$(dirname "$EVIDENCE_DIR")" "$(basename "$EVIDENCE_DIR")"
  chmod 600 "$EV_FILE"
  encrypt "$EV_FILE"
else
  echo "==> Evidence dir not found ($EVIDENCE_DIR) — skipping file backup."
fi

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -maxdepth 1 -name 'edify-*' -type f -mtime "+$RETENTION_DAYS" -print -delete || true

echo "==> Backup complete: $BACKUP_DIR (stamp $STAMP)"
