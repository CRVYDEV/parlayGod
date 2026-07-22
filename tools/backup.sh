#!/usr/bin/env bash
# Nightly Postgres backup (M5). Cron it on the DB host or a worker box:
#   0 4 * * * DATABASE_URL=postgres://... /path/to/tools/backup.sh /backups
# Keeps 14 days of compressed dumps. pg-mem (dev) has nothing to back up.
set -euo pipefail
# (red-team R14) The dump is a COMPLETE copy of the DB — accounts, wallet addresses, the whole ledger.
# umask 077 so it's written 0600 (owner-only), never group/world-readable on a shared/misconfigured host.
umask 077
DEST="${1:-./backups}"
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL not set — nothing to back up (pg-mem?)"; exit 1; }
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DEST/omerta-$STAMP.dump"
# NOTE: passing the DSN on argv leaks the DB password via `ps`/`/proc/<pid>/cmdline` to any local user
# for the dump's duration. On a shared host, prefer a ~/.pgpass (chmod 600) + a password-less DSN, or a
# libpq connection-service file (PGSERVICEFILE), so the secret never reaches the process table.
pg_dump --no-owner --format=custom "$DATABASE_URL" > "$OUT"
chmod 600 "$OUT"
find "$DEST" -name 'omerta-*.dump' -mtime +14 -delete
echo "backup written: $OUT"
