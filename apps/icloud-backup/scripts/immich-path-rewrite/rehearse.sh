#!/usr/bin/env bash
# Rehearse rewrite.sql on a COPY of the production Immich database.
#
# 1. pg_dump the production database (read-only, via the container's own
#    credentials, never printed) to a mode-600 file.
# 2. Restore it into a throwaway Postgres container (same image as
#    infra/immich.yml; own network, no ports, name prefix icloud-adoption-).
# 3. Run rewrite.sql for "Jeremy iCloud" (/icloud) and "Mom's iCloud"
#    (/icloud-mom) with the placeholder folders rehearsal-a and rehearsal-b.
# 4. Print the checks: checksum formula, counts before/after, nothing left
#    under the old prefixes, other libraries unchanged, no duplicates, sidecar
#    and integrity rows moved, a second run refused.
# 5. Unless --no-scan: start a throwaway immich-server against the rewritten
#    copy, give library A three files at their new path, scan, and say whether
#    Immich kept the existing asset ids.
# 6. Remove every container, network, volume and the dump, and list what is left.
#
# Usage: rehearse.sh [--no-scan]
# Env:   KEEP=1  keep the containers, volumes and dump (debugging only; the dump
#                holds Immich password hashes and API-key hashes, mode 600).
#        SRC_CONTAINER  production database container (lilnas-immich-database-1)
#        IMMICH_YML     compose file to read the image pins from (infra/immich.yml)
#
# Touches production only through one `docker exec ... pg_dump`.
set -euo pipefail
umask 077

SRC_CONTAINER=${SRC_CONTAINER:-lilnas-immich-database-1}
PREFIX=icloud-adoption
WORK=/storage/workspace/icloud-adoption-rehearsal
NET=$PREFIX-net
DB=$PREFIX-db
REDIS=$PREFIX-redis
IMMICH=$PREFIX-immich
PGVOL=$PREFIX-pgdata
UPVOL=$PREFIX-upload
DUMP=$WORK/immich.dump
ENVFILE=$WORK/throwaway.env
SCAN_DIR=$WORK/scan-folder

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
IMMICH_YML=${IMMICH_YML:-$REPO/infra/immich.yml}
REWRITE_SQL=$HERE/rewrite.sql

DO_SCAN=1
case "${1:-}" in
  '') ;;
  --no-scan) DO_SCAN=0 ;;
  *) echo "usage: $0 [--no-scan]" >&2; exit 2 ;;
esac

section() { printf '\n== %s ==\n' "$*"; }

# image <service>: the pinned image of a service in infra/immich.yml
image_of() {
  awk -v s="  $1:" '$0 == s {f=1; next} f && /^  [a-z]/ {f=0} f && /^    image:/ {print $2; exit}' "$IMMICH_YML"
}

cleanup() {
  local rc=$?
  set +e
  if [ "${KEEP:-0}" = 1 ]; then
    echo "KEEP=1: leaving $PREFIX-* resources and $WORK in place"
    exit $rc
  fi
  section "cleanup"
  docker rm -f -v "$IMMICH" "$REDIS" "$DB" >/dev/null 2>&1
  docker network rm "$NET" >/dev/null 2>&1
  docker volume rm "$PGVOL" "$UPVOL" >/dev/null 2>&1
  rm -rf "$SCAN_DIR" "$DUMP" "$ENVFILE"
  rmdir "$WORK" 2>/dev/null
  echo "containers : $(docker ps -a --filter "name=$PREFIX-" --format '{{.Names}}' | wc -l) left"
  echo "networks   : $(docker network ls --filter "name=$PREFIX-" --format '{{.Name}}' | wc -l) left"
  echo "volumes    : $(docker volume ls --filter "name=$PREFIX-" --format '{{.Name}}' | wc -l) left"
  if [ -e "$WORK" ]; then echo "workdir    : STILL THERE: $(ls -A "$WORK" | tr '\n' ' ')"; else echo "workdir    : gone ($WORK)"; fi
  exit $rc
}
trap cleanup EXIT

DB_IMAGE=$(image_of immich-database)
REDIS_IMAGE=$(image_of immich-redis)
SERVER_IMAGE=$(image_of immich)
[ -n "$DB_IMAGE" ] && [ -n "$REDIS_IMAGE" ] && [ -n "$SERVER_IMAGE" ] || { echo "cannot read image pins from $IMMICH_YML" >&2; exit 1; }
docker inspect "$SRC_CONTAINER" >/dev/null 2>&1 || { echo "$SRC_CONTAINER is not running" >&2; exit 1; }
if [ -n "$(docker ps -aq --filter "name=$PREFIX-")" ] || docker network inspect "$NET" >/dev/null 2>&1; then
  echo "leftovers named $PREFIX-* exist; remove them first" >&2
  trap - EXIT
  exit 1
fi

# psql in the throwaway database. q: unaligned tuples only; qr: readable table.
q()  { docker exec -i "$DB" psql -U postgres -d immich -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
qr() { docker exec -i "$DB" psql -U postgres -d immich -X -q -v ON_ERROR_STOP=1 "$@"; }

mkdir -p "$WORK"
chmod 700 "$WORK"

# ---------------------------------------------------------------- 1. dump ----
section "1. read-only dump of $SRC_CONTAINER"
rm -f "$DUMP"
( umask 077
  docker exec "$SRC_CONTAINER" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$DUMP" )
chmod 600 "$DUMP"
echo "dump: $(stat -c '%s bytes, mode %a' "$DUMP")"

# ------------------------------------------------------- 2. throwaway db -----
section "2. throwaway database ($DB_IMAGE)"
docker network create --internal "$NET" >/dev/null
docker volume create "$PGVOL" >/dev/null
docker volume create "$UPVOL" >/dev/null
THROWAWAY_PW=$(openssl rand -hex 16)
cat > "$ENVFILE" <<EOF
POSTGRES_PASSWORD=$THROWAWAY_PW
POSTGRES_USER=postgres
POSTGRES_DB=immich
EOF
chmod 600 "$ENVFILE"
docker run -d --name "$DB" --network "$NET" --env-file "$ENVFILE" --shm-size 128mb \
  -v "$PGVOL":/var/lib/postgresql/data "$DB_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres -d immich -q 2>/dev/null && break
  sleep 2
done
docker exec "$DB" pg_isready -h 127.0.0.1 -U postgres -d immich -q
restore_log=$(docker exec -i "$DB" pg_restore -U postgres -d immich --no-owner --no-privileges --exit-on-error < "$DUMP" 2>&1) \
  || { echo "$restore_log" | tail -20; echo "restore failed" >&2; exit 1; }
echo "restored; assets in the copy: $(q -c 'select count(*) from asset')"

# ------------------------------------------------------------ libraries ------
LIB_A=$(q -c "select id from library where \"importPaths\" = ARRAY['/icloud']::text[]")
LIB_B=$(q -c "select id from library where \"importPaths\" = ARRAY['/icloud-mom']::text[]")
[ -n "$LIB_A" ] && [ -n "$LIB_B" ] || { echo "cannot find both libraries by import path" >&2; exit 1; }
count_under() { q -c "select count(*) from asset where \"libraryId\" = '$1' and starts_with(\"originalPath\", '$2/')"; }
EXP_A=$(count_under "$LIB_A" /icloud)
EXP_B=$(count_under "$LIB_B" /icloud-mom)
NEW_A=/icloud-users/rehearsal-a
NEW_B=/icloud-users/rehearsal-b

# Where else does the string appear? Every text-ish column of every table.
section "3. every column that mentions /icloud (before)"
q <<'EOF' | grep -v '^$' | grep -v '|0$' || true
select format('select %L || ''.'' || %L, count(*) from public.%I where %I::text like %L',
              c.table_name, c.column_name, c.table_name, c.column_name, '%/icloud%')
  from information_schema.columns c
  join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
 where c.table_schema = 'public'
   and c.data_type in ('character varying', 'text', 'ARRAY', 'jsonb', 'json')
\gexec
EOF

CHECKSUM_SQL=$(cat <<'EOF'
begin;
create extension pgcrypto;
select l.name as library, a."checksumAlgorithm" as algo, count(*) as rows,
       count(*) filter (where a.checksum = digest('path:' || a."originalPath", 'sha1')) as formula_matches
  from asset a join library l on l.id = a."libraryId"
 group by 1, 2 order by 1, 2;
rollback;
EOF
)
snapshot() { # $1 label: count + old-prefix residue per library
  qr <<EOF
select l.name as library, l."importPaths" as import_paths,
       count(a.id) as assets,
       count(a.id) filter (where starts_with(a."originalPath", '/icloud/')) as under_icloud,
       count(a.id) filter (where starts_with(a."originalPath", '/icloud-mom/')) as under_icloud_mom,
       count(a.id) filter (where starts_with(a."originalPath", '/icloud-users/')) as under_icloud_users
  from library l left join asset a on a."libraryId" = l.id
 group by l.id, l.name, l."importPaths" order by l.name;
select 'asset' as "table", count(*) filter (where starts_with("originalPath", '/icloud/') or starts_with("originalPath", '/icloud-mom/')) as under_old_prefixes,
       count(*) filter (where starts_with("originalPath", '/icloud-users/')) as under_icloud_users from asset
union all select 'asset_file', count(*) filter (where starts_with(path, '/icloud/') or starts_with(path, '/icloud-mom/')),
       count(*) filter (where starts_with(path, '/icloud-users/')) from asset_file
union all select 'integrity_report', count(*) filter (where starts_with(path, '/icloud/') or starts_with(path, '/icloud-mom/')),
       count(*) filter (where starts_with(path, '/icloud-users/')) from integrity_report;
select 'asset_file' as "table", type, path from asset_file where path like '%/icloud%' ;
select 'integrity_report' as "table", type, path from integrity_report where path like '%/icloud%' order by path;
EOF
}
# md5 over every row that is not in LIB_A / LIB_B: the other libraries' assets
# and files, the libraries themselves, and the albums, faces, people.
untouched_fingerprint() {
  q <<EOF
select 'asset (other libraries)', md5(coalesce(string_agg(a::text, '|' order by a.id), '')) from asset a
  where a."libraryId" is distinct from '$LIB_A' and a."libraryId" is distinct from '$LIB_B';
select 'asset_file (their assets)', md5(coalesce(string_agg(f::text, '|' order by f.id), '')) from asset_file f
  where not exists (select 1 from asset a where a.id = f."assetId" and a."libraryId" in ('$LIB_A', '$LIB_B'));
select 'library (other libraries)', md5(coalesce(string_agg(l::text, '|' order by l.id), '')) from library l
  where l.id not in ('$LIB_A', '$LIB_B');
select 'album_asset', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from album_asset x;
select 'asset_face', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from asset_face x;
select 'person', md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from person x;
select 'asset favourites (ids)', md5(coalesce(string_agg(id::text, ',' order by id), '')) from asset where "isFavorite";
EOF
}

section "4. BEFORE"
echo "library A ($LIB_A) $EXP_A asset(s) under /icloud/ -> $NEW_A"
echo "library B ($LIB_B) $EXP_B asset(s) under /icloud-mom/ -> $NEW_B"
echo
echo "-- checksum formula sha1('path:' || originalPath) against every stored checksum"
qr <<<"$CHECKSUM_SQL"
snapshot
FP_BEFORE=$(untouched_fingerprint)
FAV_A_BEFORE=$(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A' and \"isFavorite\"")
ALB_BEFORE=$(q -c "select count(*) from album_asset x join asset a on a.id = x.\"assetId\" where a.\"libraryId\" in ('$LIB_A', '$LIB_B')")
FACE_BEFORE=$(q -c "select count(*) from asset_face x join asset a on a.id = x.\"assetId\" where a.\"libraryId\" in ('$LIB_A', '$LIB_B')")

# ------------------------------------------------------------- 5. rewrite ----
rewrite() { # old new lib expected [extra psql args...]
  local old=$1 new=$2 lib=$3 exp=$4
  shift 4
  docker exec -i "$DB" psql -U postgres -d immich -X -q -v ON_ERROR_STOP=1 \
    -v old_prefix="$old" -v new_prefix="$new" -v library_id="$lib" -v expected_assets="$exp" "$@" -f - < "$REWRITE_SQL" 2>&1
}

section "5. rewrite.sql"
echo "-- library A"; rewrite /icloud "$NEW_A" "$LIB_A" "$EXP_A"
echo "-- library B"; rewrite /icloud-mom "$NEW_B" "$LIB_B" "$EXP_B"

section "6. refusals"
if out=$(rewrite /icloud "$NEW_A" "$LIB_A" "$EXP_A"); then
  echo "FAIL: second run of library A was accepted" >&2; exit 1
else echo "second run, library A: refused ->"; echo "$out" | grep -m1 ERROR; fi
if out=$(rewrite /icloud-mom "$NEW_B" "$LIB_B" "$EXP_B"); then
  echo "FAIL: second run of library B was accepted" >&2; exit 1
else echo "second run, library B: refused ->"; echo "$out" | grep -m1 ERROR; fi
if out=$(rewrite /icloud /icloud-users/rehearsal-c "$LIB_A" "$EXP_A"); then
  echo "FAIL: rewrite of an already moved library was accepted" >&2; exit 1
else echo "third attempt with another target: refused ->"; echo "$out" | grep -m1 ERROR; fi
if out=$(rewrite /icloud-users/rehearsal-b /icloud-users/rehearsal-b/x "$LIB_B" "$EXP_B"); then
  echo "FAIL: nested prefixes accepted" >&2; exit 1
else echo "nested prefixes: refused ->"; echo "$out" | grep -m1 ERROR; fi
if out=$(rewrite /icloud-users/rehearsal-b /icloud-users/rehearsal-z "$LIB_B" "$((EXP_B - 1))"); then
  echo "FAIL: wrong expected_assets accepted" >&2; exit 1
else echo "wrong expected_assets: refused ->"; echo "$out" | grep -m1 ERROR; fi
echo "dry run (rolled back):"
rewrite /icloud-users/rehearsal-b /icloud-users/rehearsal-z "$LIB_B" "$EXP_B" -v dry_run=1 | grep -E 'NOTICE|dry_run' | sed 's/^psql:[^ ]* //'
echo "after the dry run, library B is still under $NEW_B: $(count_under "$LIB_B" "$NEW_B") asset(s); pgcrypto left behind: $(q -c "select count(*) from pg_extension where extname = 'pgcrypto'")"

# ------------------------------------------------------------- 7. AFTER ------
section "7. AFTER"
echo "-- checksum formula against every stored checksum"
qr <<<"$CHECKSUM_SQL"
snapshot
FP_AFTER=$(untouched_fingerprint)
echo "-- rows outside the two libraries (before == after?)"
diff <(echo "$FP_BEFORE") <(echo "$FP_AFTER") >/dev/null && echo "identical: $(echo "$FP_BEFORE" | wc -l) fingerprints (other libraries' assets/files, libraries, albums, faces, people, favourites)" \
  || { echo "FAIL: other rows changed"; diff <(echo "$FP_BEFORE") <(echo "$FP_AFTER"); exit 1; }
echo "favourites in A: $FAV_A_BEFORE before, $(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A' and \"isFavorite\"") after"
echo "album memberships of A+B assets: $ALB_BEFORE before, $(q -c "select count(*) from album_asset x join asset a on a.id = x.\"assetId\" where a.\"libraryId\" in ('$LIB_A', '$LIB_B')") after"
echo "faces on A+B assets: $FACE_BEFORE before, $(q -c "select count(*) from asset_face x join asset a on a.id = x.\"assetId\" where a.\"libraryId\" in ('$LIB_A', '$LIB_B')") after"
echo "duplicate (ownerId, libraryId, checksum) groups, whole table: $(q -c 'select count(*) from (select 1 from asset where "libraryId" is not null group by "ownerId", "libraryId", checksum having count(*) > 1) d')"
echo "unique index in place: $(q -c "select count(*) from pg_indexes where indexname = 'asset_ownerId_libraryId_checksum_idx'")"

# ---------------------------------------------------------------- 8. scan ----
if [ "$DO_SCAN" = 1 ]; then
  section "8. immich-server scan against the rewritten copy ($SERVER_IMAGE)"
  # Three real paths of library A (images), now under NEW_A.
  mapfile -t PICK < <(q -c "select id || '|' || \"originalPath\" from asset where \"libraryId\" = '$LIB_A' and \"checksumAlgorithm\" = 'sha1-path' and \"originalPath\" ~* '\\.jpe?g\$' order by id limit 3")
  [ "${#PICK[@]}" = 3 ] || { echo "cannot pick three jpeg assets" >&2; exit 1; }
  # Plus the one odd asset of library A: isExternal = false, algorithm 'sha1',
  # but a checksum that is the path hash (an Immich integrity report flags it).
  # rewrite.sql moves its path and leaves its checksum alone.
  mapfile -t ODD < <(q -c "select id || '|' || \"originalPath\" from asset where \"libraryId\" = '$LIB_A' and \"checksumAlgorithm\" = 'sha1' and starts_with(\"originalPath\", '$NEW_A/')")
  [ "${#ODD[@]}" = 1 ] || { echo "cannot find the odd sha1 asset of library A" >&2; exit 1; }
  PICK+=("${ODD[0]}")
  rm -rf "$SCAN_DIR"; mkdir -p "$SCAN_DIR"
  PICK_IDS=()
  PICK_PATHS=()
  for row in "${PICK[@]}"; do
    id=${row%%|*}; path=${row#*|}
    rel=${path#"$NEW_A"/}
    mkdir -p "$SCAN_DIR/$(dirname "$rel")"
    case "$rel" in
      *.mp4|*.MP4) ffmpeg -v error -y -f lavfi -i "color=c=0x6644aa:s=64x48:d=1" -pix_fmt yuv420p "$SCAN_DIR/$rel" ;;
      *) ffmpeg -v error -y -f lavfi -i "color=c=0x6644aa:s=64x48" -frames:v 1 "$SCAN_DIR/$rel" ;;
    esac
    PICK_IDS+=("$id"); PICK_PATHS+=("$path")
  done
  echo "${#PICK[@]} files created under $NEW_A (3 ordinary jpegs + the odd sha1 asset, last):"; printf '  %s\n' "${PICK_PATHS[@]}"

  API_TOKEN=$(openssl rand -hex 24)
  OWNER_A=$(q -c "select \"ownerId\" from library where id = '$LIB_A'")
  q -c "insert into api_key (name, key, \"userId\", permissions) values ('rehearsal', sha256(convert_to('$API_TOKEN', 'UTF8')), '$OWNER_A', ARRAY['all']::text[])" >/dev/null

  docker run -d --name "$REDIS" --network "$NET" "$REDIS_IMAGE" >/dev/null
  cat >> "$ENVFILE" <<EOF
DB_HOSTNAME=$DB
DB_USERNAME=postgres
DB_PASSWORD=$THROWAWAY_PW
DB_DATABASE_NAME=immich
REDIS_HOSTNAME=$REDIS
IMMICH_IGNORE_MOUNT_CHECK_ERRORS=true
IMMICH_MACHINE_LEARNING_ENABLED=false
IMMICH_TELEMETRY_INCLUDE=
EOF
  docker run -d --name "$IMMICH" --network "$NET" --env-file "$ENVFILE" \
    -v "$UPVOL":/usr/src/app/upload \
    -v "$SCAN_DIR":"$NEW_A":ro \
    "$SERVER_IMAGE" >/dev/null

  api() { # method path -> http status (or ERR ...)
    docker exec -e M="$1" -e P="$2" -e K="$API_TOKEN" "$IMMICH" node -e '
      fetch("http://127.0.0.1:2283" + process.env.P, { method: process.env.M, headers: { "x-api-key": process.env.K } })
        .then((r) => { console.log(r.status); })
        .catch((e) => { console.log("ERR " + e.message); process.exit(1); });' 2>&1
  }
  up=0
  for _ in $(seq 1 90); do
    [ "$(api GET /api/server/ping 2>/dev/null | tail -1)" = 200 ] && { up=1; break; }
    sleep 2
  done
  [ "$up" = 1 ] || { docker logs --tail 30 "$IMMICH" 2>&1 | sed -E 's/(password|token)[^ ]*/<masked>/Ig'; echo "immich-server did not come up" >&2; exit 1; }
  echo "immich-server is up; library path validation says: $(api GET "/api/libraries/$LIB_A" | tail -1)"

  ids_csv=$(printf "'%s'," "${PICK_IDS[@]}"); ids_csv=${ids_csv%,}
  TOTAL_A_BEFORE=$(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A'")
  echo "scan: HTTP $(api POST "/api/libraries/$LIB_A/scan" | tail -1)"
  prev=-1; stable=0
  for _ in $(seq 1 180); do
    cur=$(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A' and not \"isOffline\"")
    if [ "$cur" = "$prev" ] && [ "$cur" -le 4 ]; then stable=$((stable + 1)); else stable=0; fi
    prev=$cur
    [ "$stable" -ge 3 ] && break
    sleep 5
  done
  sleep 10
  echo "online assets in library A after the scan: $(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A' and not \"isOffline\"") (the other ones have no file in the temp folder, so Immich marks them offline; expected)"
  echo
  echo "-- the paths: same asset id as before?"
  kept=0
  for i in "${!PICK_IDS[@]}"; do
    id=${PICK_IDS[$i]}; path=${PICK_PATHS[$i]}
    n=$(q -c "select count(*) from asset where \"originalPath\" = '$path'")
    same=$(q -c "select count(*) from asset where id = '$id' and \"originalPath\" = '$path' and not \"isOffline\" and \"deletedAt\" is null")
    echo "  $id: $n asset(s) at the path, original id online and live: $same"
    [ "$n" = 1 ] && [ "$same" = 1 ] && kept=$((kept + 1))
  done
  echo "total assets in library A: $TOTAL_A_BEFORE before, $(q -c "select count(*) from asset where \"libraryId\" = '$LIB_A'") after"
  if [ "$kept" = "${#PICK_IDS[@]}" ]; then echo "RESULT: Immich kept the existing asset ids for all $kept paths and created no new asset for them"
  else echo "RESULT: FAIL, only $kept of ${#PICK_IDS[@]} paths kept their asset id"; fi
  echo "-- immich-server log, library lines (paths masked)"
  docker logs "$IMMICH" 2>&1 | sed -E 's/\x1b\[[0-9;]*m//g' | grep -E 'LibraryService|Unable to run job handler' \
    | sed -E 's/"paths":\[[^]]*\]/"paths":[<masked>]/; s#(/[A-Za-z0-9_.-]+){3,}#<path>#g' | cut -c1-260 | tail -12
  # Expected (same code path as production, which has not scanned this library recently): the "odd" asset (isExternal = false, checksum = path hash) is invisible to the
  # path lookup of a scan, so a scan tries to import its path again and the unique checksum index refuses it:
  # "duplicate key ... asset_ownerId_libraryId_checksum_idx" for that one path. It is harmless, and rewrite.sql
  # keeps it that way (it moves that checksum along with the path). Without that, the scan creates a duplicate.
fi

# ---------------------------------------------------------- 9. rollback ------
section "9. rollback drill: restore the dump into a fresh database and swap it in"
# Immich must not be connected. The README does the same with `docker stop`.
[ "$DO_SCAN" = 1 ] && docker stop "$IMMICH" >/dev/null
pg() { docker exec -i "$DB" psql -U postgres -d postgres -X -q -A -t -v ON_ERROR_STOP=1 "$@"; }
pg -c 'create database immich_restore' >/dev/null
docker exec -i "$DB" pg_restore -U postgres -d immich_restore --no-owner --no-privileges --exit-on-error < "$DUMP"
pg -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'immich' and pid <> pg_backend_pid()" >/dev/null
pg -c 'alter database immich rename to immich_rewritten' -c 'alter database immich_restore rename to immich' >/dev/null
echo "library paths after the swap (must be the original ones):"
q -c "select name || ' ' || \"importPaths\"::text || ' ' || (select count(*) from asset a where a.\"libraryId\" = l.id and (starts_with(a.\"originalPath\", '/icloud/') or starts_with(a.\"originalPath\", '/icloud-mom/'))) || ' asset(s) under the old prefix' from library l order by name"
echo "rewritten database kept for inspection as immich_rewritten: $(pg -c "select count(*) from pg_database where datname = 'immich_rewritten'")"
