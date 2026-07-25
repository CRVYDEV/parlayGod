#!/usr/bin/env bash
# THE BACKUP'S OWN REGRESSION TEST.
#
# tools/backup.sh is the last line of defence: if it is wrong, the failure is silent and you find out
# on the day you need a restore. Its verification logic was written after the 2026-07-25 incident and
# two real defects were caught by hand while writing it —
#
#   • `pg_restore --data-only --table=X "$DUMP"` with NO `-f -` refuses to run and emits nothing, which
#     the row counter read as "zero rows". That would have failed EVERY backup, not just bad ones.
#   • a schema-only database (schema.sql loaded, no rows) dumps to 161 TABLE DATA entries and ~194 KB,
#     clearing the table count and any sane size floor while holding not one account.
#
# Both were found by running it, neither by reading it. So the checks get a test of their own, and the
# test's job is to prove each one FAILS when it should — a verification that cannot fail is decoration.
#
#   DATABASE_URL=postgres://... bash tools/backup-selftest.sh
#
# Needs a throwaway Postgres it may create and drop databases on. Exits non-zero on any failure.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP="$HERE/backup.sh"
[ -n "${DATABASE_URL:-}" ] || { echo "backup-selftest needs DATABASE_URL pointed at a throwaway Postgres."; exit 2; }

pass=0; fails=()
# On failure, always show what backup.sh actually SAID. Without this a red CI run reports only which
# assertion failed, not why — and "the cold database was refused for the wrong reason" is unreadable
# without the reason. OUTPUT holds the last `run` invocation's combined output.
check() { # check <ok?> <label> [detail]
  if [ "$1" = "0" ]; then pass=$((pass+1)); echo "  ✓ $2"; return; fi
  fails+=("$2${3:+ — $3}")
  echo "  ✗ $2${3:+ — $3}"
  [ -n "${OUTPUT:-}" ] && echo "$OUTPUT" | tail -20 | sed 's/^/      | /'
}
# `check_ok CMD…` — expect success; `check_fail CMD…` — expect a non-zero exit.
run() { OUTPUT="$("$@" 2>&1)"; RC=$?; return 0; }
# Substring tests use bash, never `echo … | grep -q`. Under `pipefail` that pipeline reports failure
# on a MATCH when grep exits first and SIGPIPEs the writer — the exact bug this suite just caught in
# backup.sh, and there is no reason to reintroduce it in the thing testing for it.
said() { case "$OUTPUT" in *"$1"*) return 0;; *) return 1;; esac; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# ── fixtures ───────────────────────────────────────────────────────────────────────────────────
# Two databases: one with real rows, one with schema and nothing else. The empty one is the whole
# point — it is the shape that silently passed before.
ADMIN="${DATABASE_URL%%\?*}"; ADMIN_Q=""
case "$DATABASE_URL" in *\?*) ADMIN_Q="?${DATABASE_URL#*\?}";; esac
base_url() { # swap the database name in the DSN, keeping any ?host=…&port=… query intact
  local db="$1" head="${ADMIN%/*}"
  echo "${head}/${db}${ADMIN_Q}"
}
# Fixture setup must FAIL LOUDLY. Swallowing its errors is how the first draft of this file reported
# "a populated database backs up cleanly ✗" when the truth was that the INSERTs had never landed — the
# same silent-failure shape the whole script exists to catch.
psql_q() {
  local err
  err="$(psql "$(base_url "$1")" -v ON_ERROR_STOP=1 -tAc "$2" 2>&1)" || {
    echo "backup-selftest: FIXTURE SETUP FAILED on $1" >&2; echo "  $2" >&2; echo "  $err" >&2; exit 2; }
}

FULL_DB="bkchk_full_$$"; COLD_DB="bkchk_cold_$$"; TINY_DB="bkchk_tiny_$$"
ADMIN_DB_URL="$(base_url postgres)"
for db in "$FULL_DB" "$COLD_DB" "$TINY_DB"; do
  psql "$ADMIN_DB_URL" -v ON_ERROR_STOP=1 -tAc "CREATE DATABASE $db" >/dev/null 2>&1
done
cleanup_dbs() {
  for db in "$FULL_DB" "$COLD_DB" "$TINY_DB"; do
    psql "$ADMIN_DB_URL" -tAc "DROP DATABASE IF EXISTS $db" >/dev/null 2>&1
  done
}
trap 'cleanup_dbs; rm -rf "$WORK"' EXIT

# The real schema, so the table-count and required-table checks see what production sees.
# LOUD, for the same reason psql_q is: a silently half-loaded schema does not announce itself, it just
# makes a later check fail for the wrong reason. On CI this cost a round trip — the cold-database
# checks failed and the log could not say why, because the only evidence had been sent to /dev/null.
loadSchema() {
  local err
  err="$(psql "$(base_url "$1")" -v ON_ERROR_STOP=1 -f "$HERE/../schema.sql" 2>&1 >/dev/null)" || {
    echo "backup-selftest: SCHEMA LOAD FAILED on $1" >&2; echo "$err" | tail -20 >&2; exit 2; }
  # and prove it landed, rather than trusting a zero exit
  local n
  n="$(psql "$(base_url "$1")" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null | tr -d ' ')"
  [ "${n:-0}" -ge 40 ] || {
    echo "backup-selftest: schema loaded into $1 but only $n tables exist — the fixture is not what the test assumes." >&2
    exit 2; }
  # A COUNT is not the assertion that matters. backup.sh insists on three tables BY NAME, so the
  # fixture has to be checked by name too — otherwise "table X is missing from the dump" is ambiguous
  # between a broken dump and a fixture that never had X, which is exactly the ambiguity that cost a
  # CI round trip to resolve.
  local missing
  missing="$(psql "$(base_url "$1")" -tAc \
    "SELECT string_agg(t,',') FROM unnest(ARRAY['accounts','characters','transactions']) t
      WHERE to_regclass('public.'||t) IS NULL" 2>/dev/null | tr -d ' ')"
  [ -z "$missing" ] || {
    echo "backup-selftest: $1 has $n tables but is missing: $missing — the fixture is not what the test assumes." >&2
    exit 2; }
}
loadSchema "$FULL_DB"
loadSchema "$COLD_DB"
# Rows in the two tables the script insists on. Every NOT NULL column without a default has to be
# supplied — accounts needs the auth pair, characters needs a season.
psql_q "$FULL_DB" "INSERT INTO accounts (id, auth_provider, auth_subject)
                   VALUES (gen_random_uuid(),'guest','selftest-1'), (gen_random_uuid(),'guest','selftest-2')"
psql_q "$FULL_DB" "INSERT INTO characters (id, account_id, name, season)
                   SELECT gen_random_uuid(), id, 'Selftest '||substr(id::text,1,8), 1 FROM accounts"
# a database that is NOT omerta — one table, to trip the schema check
psql_q "$TINY_DB" "CREATE TABLE unrelated (id int); INSERT INTO unrelated VALUES (1)"
# The fixture is the ground the whole run stands on: if these rows are not here, every later failure
# is about the fixture and not about backup.sh.
FIXTURE="$(psql "$(base_url "$FULL_DB")" -tAc \
  "SELECT (SELECT count(*) FROM accounts)||'/'||(SELECT count(*) FROM characters)" 2>/dev/null | tr -d ' ')"
[ "$FIXTURE" = "2/2" ] || {
  echo "backup-selftest: fixture rows are $FIXTURE, expected 2/2 (accounts/characters)." >&2; exit 2; }
echo "client: pg_dump $(pg_dump --version | awk '{print $3}'), pg_restore $(pg_restore --version | awk '{print $3}'), psql $(psql --version | awk '{print $3}')"
echo "server: $(psql "$ADMIN_DB_URL" -tAc 'SHOW server_version' 2>/dev/null | tr -d ' ')   fixture: $FIXTURE accounts/characters"

echo
echo "0. THE REQUIRED-TABLE CHECK DOES NOT PIPE INTO grep -q"
# A SOURCE-LEVEL tripwire, and labelled as one: the bug it guards is a RACE, so the behavioural test
# below cannot be relied on to reproduce it. `echo "$TOC" | grep -q PATTERN` under `pipefail` reports
# FAILURE on a match whenever grep exits first and SIGPIPEs the writer mid-TOC — CI hit it on every
# run while it never once fired here, and it blamed a different table each time. The consequence is a
# nightly backup refusing a GOOD dump and reporting a table as missing that is demonstrably present.
# Since the reproduction is environmental, the guard is textual.
# Comments are stripped first — the fix in backup.sh QUOTES the bad pattern while explaining it, and
# a tripwire that trips on its own documentation is a tripwire nobody keeps.
BADPAT='echo "$TOC" | grep -q'
case "$(grep -v '^[[:space:]]*#' "$BACKUP")" in
  *"$BADPAT"*) check 1 "backup.sh matches TOC entries without a grep -q pipeline" "found: $BADPAT";;
  *)           check 0 "backup.sh matches TOC entries without a grep -q pipeline";;
esac

echo
echo "1. A GOOD BACKUP IS KEPT"
DEST="$WORK/good"
run env DATABASE_URL="$(base_url "$FULL_DB")" bash "$BACKUP" "$DEST"
check $RC "a populated database backs up cleanly" "$(echo "$OUTPUT" | tail -2 | tr '\n' ' ')"
DUMPS=("$DEST"/omerta-*.dump)
check $([ -f "${DUMPS[0]}" ] && echo 0 || echo 1) "the dump lands under its real name"
check $([ -z "$(find "$DEST" -name '*.part' 2>/dev/null)" ] && echo 0 || echo 1) "no .part left behind"
PERM="$(stat -c '%a' "${DUMPS[0]}" 2>/dev/null)"
check $([ "$PERM" = "600" ] && echo 0 || echo 1) "the dump is owner-only (0600)" "got $PERM"

echo
echo "2. THE SCHEMA-ONLY TRAP — the hole that passed before"
# 161 tables, ~194 KB, zero accounts. Table count and size floor BOTH clear. Only reading the data
# section back can tell the difference, which is why that check exists.
DEST="$WORK/cold"
run env DATABASE_URL="$(base_url "$COLD_DB")" bash "$BACKUP" "$DEST"
check $([ $RC -ne 0 ] && echo 0 || echo 1) "a schema-only database is REFUSED, not silently kept" "rc=$RC"
check $(said "holds 0 rows" && echo 0 || echo 1) "…and says why (zero rows, not 'looks fine')"
check $([ -z "$(find "$DEST" -name '*.dump' 2>/dev/null)" ] && echo 0 || echo 1) "the refused dump is not kept"
check $([ -z "$(find "$DEST" -name '*.part' 2>/dev/null)" ] && echo 0 || echo 1) "no .part survives the refusal"
# …and the documented escape hatch for a genuinely new deployment must work
run env DATABASE_URL="$(base_url "$COLD_DB")" BACKUP_MIN_ROWS=0 bash "$BACKUP" "$DEST"
check $RC "BACKUP_MIN_ROWS=0 allows a genuinely cold database through"

echo
echo "3. A TRUNCATED DUMP IS CAUGHT"
# The original failure mode: pg_dump dies mid-stream and leaves a plausible-looking file. Stub pg_dump
# with one that writes a valid header and then stops.
mkdir -p "$WORK/stub"
cat > "$WORK/stub/pg_dump" <<'STUB'
#!/usr/bin/env bash
# emit a real archive, then chop it in half — a dump that starts well and ends nowhere
out=""; prev=""
for a in "$@"; do case "$prev" in --file) out="$a";; esac; case "$a" in --file=*) out="${a#--file=}";; esac; prev="$a"; done
real="$(PATH=/usr/bin:/bin command -v pg_dump)"
"$real" "$@" || exit $?
size=$(wc -c < "$out"); head -c $((size / 2)) "$out" > "$out.chopped" && mv "$out.chopped" "$out"
STUB
chmod +x "$WORK/stub/pg_dump"
DEST="$WORK/trunc"
run env PATH="$WORK/stub:$PATH" DATABASE_URL="$(base_url "$FULL_DB")" bash "$BACKUP" "$DEST"
check $([ $RC -ne 0 ] && echo 0 || echo 1) "a truncated dump is REFUSED" "rc=$RC"
check $([ -z "$(find "$DEST" -name '*.dump' 2>/dev/null)" ] && echo 0 || echo 1) "the truncated dump is not kept"
check $([ -z "$(find "$DEST" -name '*.part' 2>/dev/null)" ] && echo 0 || echo 1) "no .part survives a truncated dump"

echo
echo "4. THE WRONG DATABASE IS CAUGHT"
DEST="$WORK/wrong"
run env DATABASE_URL="$(base_url "$TINY_DB")" bash "$BACKUP" "$DEST"
check $([ $RC -ne 0 ] && echo 0 || echo 1) "a stale DATABASE_URL pointing elsewhere is REFUSED" "rc=$RC"
check $( { said "tables in the dump" || said "is missing from the dump"; } && echo 0 || echo 1) \
  "…and names the reason (wrong database / no schema)"

echo
echo "5. AN UNREACHABLE DATABASE FAILS LOUDLY"
DEST="$WORK/down"
run env DATABASE_URL="postgres://nobody@127.0.0.1:1/none" bash "$BACKUP" "$DEST"
check $([ $RC -ne 0 ] && echo 0 || echo 1) "an unreachable database is a failure, not an empty success" "rc=$RC"
check $([ -z "$(find "$DEST" -name '*.dump' 2>/dev/null)" ] && echo 0 || echo 1) "nothing is kept when the dump never ran"

echo
echo "6. THE SIZE FLOOR STILL BITES"
DEST="$WORK/size"
run env DATABASE_URL="$(base_url "$FULL_DB")" BACKUP_MIN_BYTES=999999999 bash "$BACKUP" "$DEST"
check $([ $RC -ne 0 ] && echo 0 || echo 1) "a dump under the size floor is REFUSED" "rc=$RC"

echo
echo "7. RETENTION HOLDS FIRE AFTER A BAD NIGHT"
# The rule that matters most: a run of failures must never age out the last GOOD backup. Retention
# runs only after a verified dump lands, so an ancient-but-good dump survives a failing run.
DEST="$WORK/retain"; mkdir -p "$DEST"
OLD="$DEST/omerta-20000101-000000.dump"
head -c 60000 /dev/urandom > "$OLD"; touch -d '60 days ago' "$OLD"
run env DATABASE_URL="$(base_url "$COLD_DB")" bash "$BACKUP" "$DEST"   # fails: zero rows
check $([ $RC -ne 0 ] && echo 0 || echo 1) "the bad run fails" "rc=$RC"
check $([ -f "$OLD" ] && echo 0 || echo 1) "a 60-day-old GOOD backup survives the failed run"
# and once a good dump lands, retention does prune
run env DATABASE_URL="$(base_url "$FULL_DB")" bash "$BACKUP" "$DEST"
check $RC "a good run succeeds in the same directory"
check $([ ! -f "$OLD" ] && echo 0 || echo 1) "…and only then is the expired dump pruned"

echo
echo "8. THE DUMP CAN ACTUALLY BE RESTORED"
# The end of the whole exercise. A backup nobody has restored is a hypothesis.
RESTORE_DB="bkchk_restore_$$"
psql "$ADMIN_DB_URL" -tAc "CREATE DATABASE $RESTORE_DB" >/dev/null 2>&1
GOOD="$(find "$WORK/good" -name 'omerta-*.dump' | head -1)"
run pg_restore --no-owner --dbname="$(base_url "$RESTORE_DB")" "$GOOD"
RESTORED="$(psql "$(base_url "$RESTORE_DB")" -tAc 'SELECT count(*) FROM accounts' 2>/dev/null | tr -d ' ')"
check $([ "${RESTORED:-0}" -ge 2 ] && echo 0 || echo 1) "the dump restores into an empty database with its rows" "accounts=$RESTORED"
psql "$ADMIN_DB_URL" -tAc "DROP DATABASE IF EXISTS $RESTORE_DB" >/dev/null 2>&1

echo
if [ ${#fails[@]} -eq 0 ]; then
  echo "$pass passed, 0 failed"
  echo "✅ backup-selftest passed — every verification in backup.sh refuses what it should, keeps what it should, and the dump restores."
  exit 0
fi
echo "$pass passed, ${#fails[@]} failed"
printf '  • %s\n' "${fails[@]}"
exit 1
