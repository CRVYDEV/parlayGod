#!/usr/bin/env bash
# Nightly Postgres backup (M5). Cron it on the DB host or a worker box:
#   0 4 * * * DATABASE_URL=postgres://... /path/to/tools/backup.sh /backups
# Keeps 14 days of compressed dumps. pg-mem (dev) has nothing to back up.
set -euo pipefail
DEST="${1:-./backups}"
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL not set — nothing to back up (pg-mem?)"; exit 1; }
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
pg_dump --no-owner --format=custom "$DATABASE_URL" > "$DEST/omerta-$STAMP.dump"
find "$DEST" -name 'omerta-*.dump' -mtime +14 -delete
echo "backup written: $DEST/omerta-$STAMP.dump"
