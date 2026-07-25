#!/usr/bin/env bash
# Nightly Postgres backup. Cron it on the DB host or a worker box:
#   0 4 * * * DATABASE_URL=postgres://... /path/to/tools/backup.sh /backups
# Keeps 14 days of compressed dumps. pg-mem (dev) has nothing to back up.
#
# EVERY VERIFICATION STEP BELOW EXISTS BECAUSE A BACKUP THAT LOOKS FINE AND ISN'T IS WORSE THAN NONE.
# The 2026-07-25 incident made that concrete: Render's managed WAL archiving failed for ~11 minutes
# (pgbackrest archive-push, exit 82, the same segment retried until it gave up) while the dashboard
# and the database itself looked perfectly healthy. The backup chain was severed and nothing said so.
#
# The old version of this script had the same shape of problem. `pg_dump > "$OUT"` writes straight to
# the FINAL filename, so a dump that dies halfway — disk full, connection dropped mid-stream, the
# database restarting under you — leaves a TRUNCATED file sitting there with a plausible name and
# timestamp. `set -e` stops the script, but the corpse stays on disk and the next `ls` looks like a
# healthy backup directory. Nothing ever opened a dump to check it could be read back.
#
# So now: dump to a temp name, VERIFY it, and only then move it into place. A backup only counts once
# something has read it back.
set -euo pipefail
# (red-team R14) The dump is a COMPLETE copy of the DB — accounts, wallet addresses, the whole ledger.
# umask 077 so it's written 0600 (owner-only), never group/world-readable on a shared/misconfigured host.
umask 077
DEST="${1:-./backups}"
[ -n "${DATABASE_URL:-}" ] || { echo "DATABASE_URL not set — nothing to back up (pg-mem?)"; exit 1; }
mkdir -p "$DEST"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DEST/omerta-$STAMP.dump"
PART="$OUT.part"

# a failed run must never leave a half-written file behind that looks like a backup
cleanup() { [ -f "$PART" ] && rm -f "$PART"; }
trap cleanup EXIT

# NOTE: passing the DSN on argv leaks the DB password via `ps`/`/proc/<pid>/cmdline` to any local user
# for the dump's duration. On a shared host, prefer a ~/.pgpass (chmod 600) + a password-less DSN, or a
# libpq connection-service file (PGSERVICEFILE), so the secret never reaches the process table.
echo "dumping…"
pg_dump --no-owner --format=custom --file="$PART" "$DATABASE_URL"

# ── VERIFY ─────────────────────────────────────────────────────────────────────────────────────
# `pg_restore --list` reads the custom-format archive's table of contents end to end. A truncated or
# corrupt dump fails here — the check the old script never had.
echo "verifying…"
TOC="$(pg_restore --list "$PART" 2>&1)" || {
  echo "BACKUP FAILED: the dump is not readable by pg_restore — refusing to keep it." >&2
  echo "$TOC" >&2
  exit 1
}

# It must be OMERTÀ's schema, not some other database we were pointed at by a stale DATABASE_URL.
TABLES="$(echo "$TOC" | grep -c 'TABLE DATA' || true)"
MIN_TABLES="${BACKUP_MIN_TABLES:-40}"
[ "$TABLES" -ge "$MIN_TABLES" ] || {
  echo "BACKUP FAILED: only $TABLES tables in the dump (expected ≥ $MIN_TABLES) — wrong database, or no schema." >&2
  exit 1
}
# and specifically the tables whose loss is unrecoverable: who people are, and every value movement
for t in accounts characters transactions; do
  echo "$TOC" | grep -q "TABLE DATA public $t " || {
    echo "BACKUP FAILED: '$t' is missing from the dump — this is not a usable backup of OMERTÀ." >&2
    exit 1
  }
done

# CONTAINS ROWS, not just tables. Measured, not assumed: a schema-only database (schema.sql loaded,
# nothing else) dumps to 161 TABLE DATA entries and ~194 KB — it clears the table count AND any
# sane size floor while holding not one account. So the count of tables proves nothing about data;
# only reading the data section back does. That is the exact failure this whole script exists for:
# a backup that looks fine and isn't. Restoring one table's data section also re-reads compressed
# payload the TOC scan never touches, so a dump corrupt in its body and intact in its header fails here.
rowsOf() { # data rows for one table inside the archive; stops early so a huge table stays cheap
  # `-f -` is required: without a destination pg_restore refuses to run at all, and the resulting
  # empty output would read as "zero rows" — failing every backup instead of only the bad ones.
  set +o pipefail
  pg_restore --data-only --table="$1" -f - "$PART" 2>/dev/null \
    | awk '/^COPY /{d=1;next} /^\\\.$/{d=0} d{n++; if(n>=1000) exit} END{print n+0}'
  set -o pipefail
}
MIN_ROWS="${BACKUP_MIN_ROWS:-1}"   # set 0 for a genuinely cold database (nobody has signed up yet)
if [ "$MIN_ROWS" -gt 0 ]; then
  for t in accounts characters; do
    ROWS="$(rowsOf "$t")"
    [ "${ROWS:-0}" -ge "$MIN_ROWS" ] || {
      echo "BACKUP FAILED: '$t' holds $ROWS rows in the dump (expected ≥ $MIN_ROWS)." >&2
      echo "  Either the dump's data section is unreadable, or DATABASE_URL points at an empty database." >&2
      echo "  If the game genuinely has no players yet, run with BACKUP_MIN_ROWS=0." >&2
      exit 1
    }
  done
fi

# a floor on size — a last catch for degenerate archives
BYTES="$(wc -c < "$PART")"
MIN_BYTES="${BACKUP_MIN_BYTES:-51200}"
[ "$BYTES" -ge "$MIN_BYTES" ] || {
  echo "BACKUP FAILED: dump is only $BYTES bytes (expected ≥ $MIN_BYTES)." >&2
  exit 1
}

# ── COMMIT ─────────────────────────────────────────────────────────────────────────────────────
# Verified — now it earns the real name. Retention runs ONLY after a good dump lands, so a run of bad
# nights can never age out the last known-good backup.
chmod 600 "$PART"
mv "$PART" "$OUT"
trap - EXIT
find "$DEST" -name 'omerta-*.dump' -mtime +14 -delete
find "$DEST" -name 'omerta-*.dump.part' -mtime +1 -delete   # stale partials from killed runs

echo "backup verified: $OUT ($BYTES bytes, $TABLES tables)"
echo "restore with: pg_restore --no-owner --clean --if-exists -d <target> $OUT"
