# Move the two existing iCloud folders under `/icloud-users`, keep Immich's assets

`/storage/photos/icloud` (Immich library "Jeremy iCloud", import path `/icloud`) and
`/storage/photos/icloud-mom` ("Mom's iCloud", `/icloud-mom`) move to
`/storage/photos/icloud-users/<folder>`, which Immich already mounts at `/icloud-users`.
Immich must know every asset under its new path without re-importing it, so asset ids,
faces, albums and favourites survive. That is an edit of Immich's database (v3.3.4), which
Immich does not support. `rewrite.sql` makes it; `rehearse.sh` proves it on a copy.

| File          | What it is                                                                 |
| ------------- | -------------------------------------------------------------------------- |
| `rewrite.sql` | One transaction, one library; every check raises and rolls everything back |
| `rehearse.sh` | Dump → throwaway Postgres → both rewrites → checks → scan → rollback drill |
| `README.md`   | This procedure                                                             |

## What `rewrite.sql` changes (one library, one transaction)

| Where                   | Change                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------- |
| `asset."originalPath"`  | `old_prefix/…` → `new_prefix/…`                                                     |
| `asset.checksum`        | recomputed where it is the path hash: `sha1('path:' \|\| originalPath)` (see below) |
| `asset_file.path`       | rows of the library's assets under `old_prefix` (one `sidecar` row under `/icloud`) |
| `integrity_report.path` | rows of the library's assets or files under `old_prefix` (two rows under `/icloud`) |
| `library."importPaths"` | replaced with `{new_prefix}`                                                        |

Thumbnails, previews and encoded videos live under `/usr/src/app/upload` and are untouched.

**Checksum formula** (immich-server v3.3.4, `LibraryService.processEntity`):
`checksum = sha1("path:" + path.normalize(originalPath))`, stored as `bytea`, with
`checksumAlgorithm = 'sha1-path'`. The script refuses to run unless that formula reproduces
**every** stored `sha1-path` checksum of the library. There is a unique index on
`("ownerId", "libraryId", checksum)`.

**Two assets are not plain `sha1-path` rows**, and the script handles both:

- _Mom's library_ has one `isExternal = false` asset whose `originalPath` is under
  `/usr/src/app/upload/encoded-video/…` (a derived video). It is not under `/icloud-mom/`, so it
  is not counted in `expected_assets`, not rewritten, and checked to be unchanged. The script
  allows assets outside the old prefix only under `/usr/src/app/upload/`.
- _Jeremy's library_ has one `isExternal = false`, `checksumAlgorithm = 'sha1'` asset,
  `/icloud/2022/11/20/IMG_7932.mp4`, whose checksum is nevertheless the path hash (Immich's
  integrity report flags it `checksum_mismatch`). A scan looks paths up only among
  `isExternal = true` rows, so it tries to import that path again and the unique index refuses
  it: one harmless `duplicate key … asset_ownerId_libraryId_checksum_idx` error per scan of
  that library (seen in the rehearsal; production has not scanned the library since Immich last
  started, so it is expected there too, not observed). The script therefore recomputes the checksum of **any** row whose checksum equals
  the hash of its old path, not only `sha1-path` rows. Left alone, the scan would create a
  duplicate asset at the new path (found in the rehearsal). A `sha1` row holding a real content
  hash keeps it.

`expected_assets` is the number of the library's assets whose path is under `old_prefix`
(18,316 for `/icloud`, 20,322 for `/icloud-mom` on 2026-11-19). After a successful run that
number is 0, so a second run is refused by the first check. Prefixes are matched as
`old_prefix || '/'` (with `starts_with`, no `LIKE`), so `/icloud` never matches `/icloud-mom`
or `/icloud-users`.

The transaction needs pgcrypto's `digest()`. It runs `CREATE EXTENSION pgcrypto` when the
extension is missing and drops it again before it ends: nothing is left behind.

## Rehearse first

```bash
apps/icloud-backup/scripts/immich-path-rewrite/rehearse.sh            # everything
apps/icloud-backup/scripts/immich-path-rewrite/rehearse.sh --no-scan  # skip the immich-server scan
```

It reads production through one `docker exec … pg_dump` and creates only `icloud-adoption-*`
containers, network and volumes, plus a mode-600 dump under
`/storage/workspace/icloud-adoption-rehearsal/`. It removes all of it on exit and prints what is
left. The dump holds Immich's password and API-key hashes: never copy it elsewhere.

## The real procedure, in order

Do this when nobody is uploading to Immich and the new icloud-backup service is not syncing
into `/storage/photos/icloud-users/<folder>`. `<folder-a>` and `<folder-b>` are the final folder
names (the folder of "Jeremy iCloud" and of "Mom's iCloud").

1. **Check the facts** (read-only):

   ```bash
   DB=lilnas-immich-database-1
   psql_db() { docker exec -i "$DB" sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
   psql_db -At -c "select id, name, \"importPaths\" from library order by name"
   psql_db -At -c "select count(*) from asset where \"libraryId\" = '<library-id>' and starts_with(\"originalPath\", '/icloud/')"
   ls -d /storage/photos/icloud /storage/photos/icloud-mom
   test ! -e /storage/photos/icloud-users/<folder-a> && test ! -e /storage/photos/icloud-users/<folder-b>
   [ "$(stat -c %d /storage/photos/icloud)" = "$(stat -c %d /storage/photos/icloud-users)" ] && echo same filesystem
   find /storage/photos/icloud -type f | wc -l; find /storage/photos/icloud-mom -type f | wc -l
   ```

   The two library ids and counts must match what the rehearsal printed. Both folders and
   `icloud-users` must share a filesystem, so that `mv` is a rename; if not, stop and use `rsync`
   plus a checked delete instead.

2. **Stop Immich** (server and machine learning; the database stays up):

   ```bash
   docker stop lilnas-immich-1 lilnas-immich-machine-learning-1
   ```

3. **Dump the database, right now** (this is the rollback point):

   ```bash
   mkdir -p -m 700 /storage/workspace/icloud-adoption-backup
   ( umask 077; docker exec "$DB" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
       > /storage/workspace/icloud-adoption-backup/immich-before-rewrite.dump )
   ls -l /storage/workspace/icloud-adoption-backup/immich-before-rewrite.dump
   ```

4. **Move the folders**:

   ```bash
   mv /storage/photos/icloud /storage/photos/icloud-users/<folder-a>
   mv /storage/photos/icloud-mom /storage/photos/icloud-users/<folder-b>
   find /storage/photos/icloud-users/<folder-a> -type f | wc -l   # same counts as step 1
   find /storage/photos/icloud-users/<folder-b> -type f | wc -l
   ```

5. **Rewrite, a dry run first** (`-v dry_run=1` rolls back at the end; drop it to commit). Run
   from this directory, once per library; on any error nothing changes:

   ```bash
   rw() { # old new library_id expected [extra psql args]
     local old=$1 new=$2 lib=$3 exp=$4; shift 4
     docker exec -i "$DB" sh -c 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -X -q -v ON_ERROR_STOP=1 -f - "$@"' sh \
       -v old_prefix="$old" -v new_prefix="$new" -v library_id="$lib" -v expected_assets="$exp" "$@" < rewrite.sql
   }
   rw /icloud       /icloud-users/<folder-a> <jeremy-library-id> 18316 -v dry_run=1
   rw /icloud-mom   /icloud-users/<folder-b> <mom-library-id>    20322 -v dry_run=1
   rw /icloud       /icloud-users/<folder-a> <jeremy-library-id> 18316
   rw /icloud-mom   /icloud-users/<folder-b> <mom-library-id>    20322
   ```

   Each run prints `pre-flight ok`, `rewrote …`, `post-checks ok`. Use the counts from step 1.

6. **Start Immich**:

   ```bash
   docker start lilnas-immich-1 lilnas-immich-machine-learning-1
   ```

   `infra/immich.yml` still bind-mounts `/storage/photos/icloud` and `/storage/photos/icloud-mom`.
   Docker creates a missing bind source as an empty root-owned directory, so these two empty
   folders reappear. They are harmless; remove the two mounts from `infra/immich.yml` (deployed by
   pushing to `main`, see `docs/deploy.md`) and then `rmdir` the empty folders.

7. **Verify** in Immich: Administration → Libraries → both libraries show the new import path;
   run **Scan**. Expected: no asset goes offline, none is imported, the asset counts are
   unchanged, the timeline, people and albums look as before. The server log shows the one
   `duplicate key … asset_ownerId_libraryId_checksum_idx` for `IMG_7932.mp4` described above;
   it is expected, not a sign that the rewrite failed.

8. **Keep the dump** until you are satisfied, then delete it:
   `rm /storage/workspace/icloud-adoption-backup/immich-before-rewrite.dump`.

## Rollback

Immich writes to the database from the moment it starts, so rolling back after step 6 loses
whatever it changed since (new uploads, edits, jobs). Before step 6 nothing else has changed.

1. Stop Immich: `docker stop lilnas-immich-1 lilnas-immich-machine-learning-1`.
2. Restore the dump from step 3 into a fresh database and swap it in (rehearsed in step 9 of
   `rehearse.sh`):

   ```bash
   DB=lilnas-immich-database-1
   pgx() { docker exec -i "$DB" sh -c 'exec psql -U "$POSTGRES_USER" -d postgres -X -v ON_ERROR_STOP=1 "$@"' sh "$@"; }
   NAME=$(docker exec "$DB" printenv POSTGRES_DB)
   pgx -c "create database immich_restore"
   docker exec -i "$DB" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d immich_restore --no-owner --no-privileges --exit-on-error' \
     < /storage/workspace/icloud-adoption-backup/immich-before-rewrite.dump
   pgx -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '$NAME' and pid <> pg_backend_pid()" \
       -c "alter database \"$NAME\" rename to immich_rewritten" \
       -c "alter database immich_restore rename to \"$NAME\""
   ```

   The rewritten database stays as `immich_rewritten` for inspection; drop it once you are done.

3. Move the folders back. If step 6 created the empty `/storage/photos/icloud` and
   `/storage/photos/icloud-mom`, `rmdir` them first, or `mv` would nest the folder inside them:

   ```bash
   rmdir /storage/photos/icloud /storage/photos/icloud-mom 2>/dev/null
   mv /storage/photos/icloud-users/<folder-a> /storage/photos/icloud
   mv /storage/photos/icloud-users/<folder-b> /storage/photos/icloud-mom
   ```

4. Start Immich: `docker start lilnas-immich-1 lilnas-immich-machine-learning-1`.
5. Check the libraries show `/icloud` and `/icloud-mom` again and run a scan.
