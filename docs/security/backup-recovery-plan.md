# Backup & Disaster Recovery Plan

Protects the two stores that hold all operational truth: the **PostgreSQL database** and the **evidence file volume**. (NIST CSF 2.0 — Recover.)

## Objectives

| | Target | How |
|---|---|---|
| **RPO** (max data loss) | ≤ 24h baseline; ≤ 5 min where the provider offers PITR | Daily logical backup (`backup.sh`) + provider continuous/PITR backups on the managed Postgres |
| **RTO** (max downtime) | ≤ 4 hours | Restore latest dump to a fresh instance + remount evidence volume |

## What is backed up

- **Database** — `pg_dump -Fc` (custom, compressed) of the whole schema + data, including the audit log, its hash chain, and the append-only triggers.
- **Evidence files** — `EVIDENCE_STORAGE_DIR` tarred (gzip).
- Both encrypted at rest (see Encryption) and copied **offsite**.

## Schedule (cron — supply the timestamp; scripts take no time syscall)

```cron
# Daily DB + evidence backup at 02:00 UTC
0 2 * * *  BACKUP_STAMP=$(date -u +%Y%m%dT%H%M%SZ) \
           DATABASE_URL=$DATABASE_URL EVIDENCE_STORAGE_DIR=/data/evidence \
           BACKUP_DIR=/backups BACKUP_AGE_RECIPIENT=$AGE_RECIPIENT \
           /app/scripts/backup.sh >> /var/log/edify-backup.log 2>&1

# Daily audit export (immutable trail), 02:30 UTC
30 2 * * * AUDIT_EXPORT_DIR=/backups/audit npm --prefix /app run audit:export -- $(date -u +%F)

# Monthly restore test, 1st at 03:00 UTC
0 3 1 * *  ADMIN_DATABASE_URL=$ADMIN_DATABASE_URL BACKUP_DIR=/backups \
           /app/scripts/restore-test.sh >> /var/log/edify-restore-test.log 2>&1
```

The managed Postgres provider's own automated/PITR backups run in addition to this — `backup.sh` is the portable, provider-independent copy.

## Encryption

`backup.sh` encrypts each artifact when `BACKUP_AGE_RECIPIENT` (age) or `BACKUP_GPG_RECIPIENT` (gpg) is set, producing `*.age`/`*.gpg` and removing the plaintext. **Never ship an unencrypted backup offsite** — the script warns loudly if no recipient is configured. Store the decryption key in the secret manager, separate from the backups themselves.

## Restore procedure

1. Provision a fresh Postgres + an empty evidence volume.
2. Decrypt the chosen DB dump: `age -d -i key.txt -o edify-db.dump edify-db-STAMP.dump.age`.
3. `pg_restore --no-owner --no-acl -d "$NEW_DATABASE_URL" edify-db.dump`.
4. Untar evidence into the new `EVIDENCE_STORAGE_DIR`.
5. Point the app's `DATABASE_URL` / `EVIDENCE_STORAGE_DIR` at the new resources.
6. Verify: `npm run audit:verify` (chain intact) and `GET /api/system-health` (0 errors).

## Monthly restore test (proves backups are real)

`restore-test.sh` restores the latest dump into a **disposable** scratch DB, asserts integrity (schools/users present, audit log present, **no payment bypassing IA**, append-only triggers survived), then drops it — never touching production. A failed run pages the on-call (Phase 11). **Last verified locally: 700 schools / 38 users / 932 audit rows restored, all assertions green.**

## Audit reconstruction

Because the audit log is append-only and hash-chained, a restored copy can be **proven** unaltered with `npm run audit:verify`. Combined with the daily NDJSON exports (`audit:export`), the trail can be reconstructed and independently checked even if the live DB is lost.

## Quarterly DR drill

Once per quarter, perform a full restore to a staging instance, bring the app up against it, and run the post-deploy smoke checks. Record RTO actually achieved and update this plan.
