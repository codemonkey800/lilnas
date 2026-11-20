-- Rewrite the paths of ONE Immich external library from old_prefix to
-- new_prefix, in one transaction, without re-importing anything (asset ids,
-- faces, albums and favourites are kept). Immich v3.3.4. Unsupported by Immich:
-- see README.md for the procedure and the rollback.
--
-- psql -v ON_ERROR_STOP=1 \
--   -v old_prefix=/icloud -v new_prefix=/icloud-users/jeremy \
--   -v library_id=<uuid> -v expected_assets=18316 [-v dry_run=1] -f rewrite.sql
--
-- old_prefix / new_prefix: absolute, normalised, no trailing slash, neither
--   one inside the other.
-- expected_assets: assets of the library whose originalPath is under
--   old_prefix. A second run finds 0 and is refused here.
-- dry_run (any value): do everything, then ROLLBACK instead of COMMIT.
--
-- What changes, for that library only:
--   asset."originalPath"            old_prefix/... -> new_prefix/...
--   asset.checksum                  recomputed where it is the path hash,
--                                   sha1('path:' || originalPath), the formula of
--                                   LibraryService.processEntity (immich-server
--                                   v3.3.4): every 'sha1-path' row, plus any
--                                   other row whose checksum equals the hash of
--                                   its old path (Immich dedupes a scan through
--                                   the unique checksum index, so such a row,
--                                   left alone, would be imported a second time
--                                   at its new path). A 'sha1' row holding a real
--                                   content hash keeps it: the file does not change.
--   asset_file.path                 rows of the library's assets under old_prefix
--   integrity_report.path           rows of the library's assets/files under it
--   library."importPaths"           replaced with {new_prefix}
-- Assets of the library outside old_prefix must live under Immich's own upload
-- folder (derived videos); they are left alone.
--
-- Any failed check raises and rolls everything back. The checksum needs
-- pgcrypto's digest(); the transaction creates the extension when it is
-- missing and drops it again before it ends, so nothing is left behind.

\set ON_ERROR_STOP on

\if :{?old_prefix}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable old_prefix is not set'; END $$;
\endif
\if :{?new_prefix}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable new_prefix is not set'; END $$;
\endif
\if :{?library_id}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable library_id is not set'; END $$;
\endif
\if :{?expected_assets}
\else
  DO $$ BEGIN RAISE EXCEPTION 'psql variable expected_assets is not set'; END $$;
\endif

BEGIN;

CREATE TEMP TABLE rw_state (k text PRIMARY KEY, v text NOT NULL) ON COMMIT DROP;

SELECT set_config('rw.old', :'old_prefix', true),
       set_config('rw.new', :'new_prefix', true),
       set_config('rw.lib', :'library_id', true),
       set_config('rw.expected', :'expected_assets', true),
       set_config('rw.upload', '/usr/src/app/upload/', true)
\gset rw_

-- Fail fast instead of waiting forever behind a running Immich.
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------- pgcrypto --
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    INSERT INTO rw_state VALUES ('created_pgcrypto', 'no');
  ELSE
    CREATE EXTENSION pgcrypto;
    INSERT INTO rw_state VALUES ('created_pgcrypto', 'yes');
  END IF;
END $$;

-- ------------------------------------------------------------ pre-flight ----
DO $$
DECLARE
  old_p   text := current_setting('rw.old');
  new_p   text := current_setting('rw.new');
  lib     uuid := current_setting('rw.lib')::uuid;
  expect  bigint := current_setting('rw.expected')::bigint;
  upload  text := current_setting('rw.upload');
  lib_row library%ROWTYPE;
  n_total bigint;
  n_under bigint;
  n_other bigint;
  n_bad   bigint;
BEGIN
  -- Prefix shape. Matching is always old || '/', so '/icloud' never matches
  -- '/icloud-mom' or '/icloud-users'.
  IF old_p !~ '^/[^/]' OR right(old_p, 1) = '/' OR old_p ~ '//|/\.\.?(/|$)' THEN
    RAISE EXCEPTION 'old_prefix % must be absolute, normalised, without a trailing slash', old_p;
  END IF;
  IF new_p !~ '^/[^/]' OR right(new_p, 1) = '/' OR new_p ~ '//|/\.\.?(/|$)' THEN
    RAISE EXCEPTION 'new_prefix % must be absolute, normalised, without a trailing slash', new_p;
  END IF;
  IF starts_with(new_p || '/', old_p || '/') OR starts_with(old_p || '/', new_p || '/') THEN
    RAISE EXCEPTION 'old_prefix % and new_prefix % must not contain one another', old_p, new_p;
  END IF;
  IF expect < 1 THEN
    RAISE EXCEPTION 'expected_assets must be at least 1, got %', expect;
  END IF;

  SELECT * INTO lib_row FROM library WHERE id = lib FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'library % does not exist', lib;
  END IF;
  IF lib_row."deletedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'library % is deleted', lib;
  END IF;

  -- The first check: the number of assets under the old prefix. After a
  -- successful run it is 0, so a second run stops here.
  SELECT count(*) INTO n_under FROM asset
   WHERE "libraryId" = lib AND starts_with("originalPath", old_p || '/');
  IF n_under <> expect THEN
    RAISE EXCEPTION 'library % has % asset(s) under %/, expected % (already rewritten?)',
      lib, n_under, old_p, expect;
  END IF;

  SELECT count(*) INTO n_total FROM asset WHERE "libraryId" = lib;
  n_other := n_total - n_under;
  SELECT count(*) INTO n_bad FROM asset
   WHERE "libraryId" = lib
     AND NOT starts_with("originalPath", old_p || '/')
     AND NOT starts_with("originalPath", upload);
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% asset(s) of library % are neither under %/ nor under Immich upload folder %',
      n_bad, lib, old_p, upload;
  END IF;

  IF lib_row."importPaths" IS DISTINCT FROM ARRAY[old_p]::text[] THEN
    RAISE EXCEPTION 'library % importPaths is %, expected {%}', lib, lib_row."importPaths", old_p;
  END IF;

  -- Nothing, anywhere, may already sit under the new prefix.
  IF EXISTS (SELECT 1 FROM asset WHERE starts_with("originalPath", new_p || '/'))
     OR EXISTS (SELECT 1 FROM asset_file WHERE starts_with(path, new_p || '/'))
     OR EXISTS (SELECT 1 FROM integrity_report WHERE starts_with(path, new_p || '/'))
     OR EXISTS (SELECT 1 FROM library WHERE new_p = ANY ("importPaths")) THEN
    RAISE EXCEPTION 'something already uses new_prefix %', new_p;
  END IF;

  -- Rows under the old prefix must all belong to this library.
  SELECT count(*) INTO n_bad FROM asset
   WHERE starts_with("originalPath", old_p || '/') AND "libraryId" IS DISTINCT FROM lib;
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% asset(s) of another library sit under %/', n_bad, old_p;
  END IF;
  SELECT count(*) INTO n_bad FROM asset_file f
   WHERE starts_with(f.path, old_p || '/')
     AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = f."assetId" AND a."libraryId" = lib);
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% asset_file row(s) outside library % sit under %/', n_bad, lib, old_p;
  END IF;
  SELECT count(*) INTO n_bad FROM integrity_report r
   WHERE starts_with(r.path, old_p || '/')
     AND NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = r."assetId" AND a."libraryId" = lib)
     AND NOT EXISTS (SELECT 1 FROM asset_file f JOIN asset a ON a.id = f."assetId"
                      WHERE f.id = r."fileAssetId" AND a."libraryId" = lib);
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% integrity_report row(s) outside library % sit under %/', n_bad, lib, old_p;
  END IF;

  -- The checksum formula must reproduce every stored 'sha1-path' checksum of
  -- the library before it is trusted to write new ones.
  SELECT count(*) INTO n_bad FROM asset
   WHERE "libraryId" = lib AND "checksumAlgorithm" = 'sha1-path'
     AND checksum IS DISTINCT FROM digest('path:' || "originalPath", 'sha1');
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% sha1-path checksum(s) are not sha1(''path:'' || originalPath); formula does not hold', n_bad;
  END IF;
  -- ...and sha1-path rows outside the prefix would not be recomputed.
  SELECT count(*) INTO n_bad FROM asset
   WHERE "libraryId" = lib AND "checksumAlgorithm" = 'sha1-path'
     AND NOT starts_with("originalPath", old_p || '/');
  IF n_bad > 0 THEN
    RAISE EXCEPTION '% sha1-path asset(s) of library % are outside %/', n_bad, lib, old_p;
  END IF;

  -- Fingerprints, compared after the rewrite.
  INSERT INTO rw_state
  SELECT 'total_assets', n_total::text
  UNION ALL SELECT 'other_assets', n_other::text
  UNION ALL SELECT 'path_hash_rows', (SELECT count(*)::text FROM asset
                                       WHERE "libraryId" = lib AND starts_with("originalPath", old_p || '/')
                                         AND checksum = digest('path:' || "originalPath", 'sha1'))
  UNION ALL SELECT 'ids', (SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '')
                             FROM asset WHERE "libraryId" = lib)
  UNION ALL SELECT 'foreign_assets', (SELECT coalesce(md5(string_agg(a::text, '|' ORDER BY a.id)), '')
                                        FROM asset a WHERE a."libraryId" IS DISTINCT FROM lib)
  UNION ALL SELECT 'upload_assets', (SELECT coalesce(md5(string_agg(a::text, '|' ORDER BY a.id)), '')
                                       FROM asset a WHERE a."libraryId" = lib
                                        AND NOT starts_with(a."originalPath", old_p || '/'))
  UNION ALL SELECT 'foreign_files', (SELECT coalesce(md5(string_agg(f::text, '|' ORDER BY f.id)), '')
                                       FROM asset_file f
                                      WHERE NOT EXISTS (SELECT 1 FROM asset a
                                                         WHERE a.id = f."assetId" AND a."libraryId" = lib))
  UNION ALL SELECT 'foreign_reports', (SELECT coalesce(md5(string_agg(r::text, '|' ORDER BY r.id)), '')
                                         FROM integrity_report r
                                        WHERE NOT EXISTS (SELECT 1 FROM asset a
                                                           WHERE a.id = r."assetId" AND a."libraryId" = lib)
                                          AND NOT EXISTS (SELECT 1 FROM asset_file f JOIN asset a ON a.id = f."assetId"
                                                           WHERE f.id = r."fileAssetId" AND a."libraryId" = lib))
  UNION ALL SELECT 'foreign_libraries', (SELECT coalesce(md5(string_agg(l::text, '|' ORDER BY l.id)), '')
                                           FROM library l WHERE l.id <> lib);

  RAISE NOTICE 'pre-flight ok: library %, % asset(s) under %/, % Immich-managed asset(s) left alone',
    lib, n_under, old_p, n_other;
END $$;

-- --------------------------------------------------------------- rewrite ----
DO $$
DECLARE
  old_p text := current_setting('rw.old');
  new_p text := current_setting('rw.new');
  lib   uuid := current_setting('rw.lib')::uuid;
  n_assets bigint;
  n_files  bigint;
  n_reports bigint;
  n_sums   bigint;
BEGIN
  UPDATE asset
     SET "originalPath" = new_p || substr("originalPath", length(old_p) + 1),
         checksum = CASE WHEN checksum = digest('path:' || "originalPath", 'sha1')
                         THEN digest('path:' || new_p || substr("originalPath", length(old_p) + 1), 'sha1')
                         ELSE checksum END
   WHERE "libraryId" = lib AND starts_with("originalPath", old_p || '/');
  GET DIAGNOSTICS n_assets = ROW_COUNT;

  SELECT v::bigint INTO n_sums FROM rw_state WHERE k = 'path_hash_rows';

  UPDATE asset_file f
     SET path = new_p || substr(f.path, length(old_p) + 1)
   WHERE starts_with(f.path, old_p || '/')
     AND EXISTS (SELECT 1 FROM asset a WHERE a.id = f."assetId" AND a."libraryId" = lib);
  GET DIAGNOSTICS n_files = ROW_COUNT;

  UPDATE integrity_report r
     SET path = new_p || substr(r.path, length(old_p) + 1)
   WHERE starts_with(r.path, old_p || '/')
     AND (EXISTS (SELECT 1 FROM asset a WHERE a.id = r."assetId" AND a."libraryId" = lib)
          OR EXISTS (SELECT 1 FROM asset_file f JOIN asset a ON a.id = f."assetId"
                      WHERE f.id = r."fileAssetId" AND a."libraryId" = lib));
  GET DIAGNOSTICS n_reports = ROW_COUNT;

  UPDATE library SET "importPaths" = ARRAY[new_p]::text[] WHERE id = lib;

  RAISE NOTICE 'rewrote % asset(s) (% path-hash checksum(s) recomputed), % asset_file row(s), % integrity_report row(s), importPaths',
    n_assets, n_sums, n_files, n_reports;
END $$;

-- ------------------------------------------------------------ post-checks ---
DO $$
DECLARE
  old_p   text := current_setting('rw.old');
  new_p   text := current_setting('rw.new');
  lib     uuid := current_setting('rw.lib')::uuid;
  expect  bigint := current_setting('rw.expected')::bigint;
  n_bad   bigint;
  n_new   bigint;
BEGIN
  IF EXISTS (SELECT 1 FROM asset WHERE starts_with("originalPath", old_p || '/'))
     OR EXISTS (SELECT 1 FROM asset_file WHERE starts_with(path, old_p || '/'))
     OR EXISTS (SELECT 1 FROM integrity_report WHERE starts_with(path, old_p || '/'))
     OR EXISTS (SELECT 1 FROM library WHERE old_p = ANY ("importPaths")) THEN
    RAISE EXCEPTION 'post-check: a row still starts with %/', old_p;
  END IF;

  IF (SELECT count(*) FROM asset WHERE "libraryId" = lib)::text
       <> (SELECT v FROM rw_state WHERE k = 'total_assets') THEN
    RAISE EXCEPTION 'post-check: the asset count of library % changed', lib;
  END IF;
  SELECT count(*) INTO n_new FROM asset
   WHERE "libraryId" = lib AND starts_with("originalPath", new_p || '/');
  IF n_new <> expect THEN
    RAISE EXCEPTION 'post-check: % asset(s) under %/, expected %', n_new, new_p, expect;
  END IF;
  IF (SELECT coalesce(md5(string_agg(id::text, ',' ORDER BY id)), '') FROM asset WHERE "libraryId" = lib)
       <> (SELECT v FROM rw_state WHERE k = 'ids') THEN
    RAISE EXCEPTION 'post-check: the asset ids of library % changed', lib;
  END IF;

  SELECT count(*) INTO n_bad FROM asset
   WHERE "libraryId" = lib AND "checksumAlgorithm" = 'sha1-path'
     AND checksum IS DISTINCT FROM digest('path:' || "originalPath", 'sha1');
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'post-check: % sha1-path checksum(s) do not match their new path', n_bad;
  END IF;
  -- Exactly the rows that were path hashes before are path hashes now.
  SELECT count(*) INTO n_bad FROM asset
   WHERE "libraryId" = lib AND starts_with("originalPath", new_p || '/')
     AND checksum = digest('path:' || "originalPath", 'sha1');
  IF n_bad::text <> (SELECT v FROM rw_state WHERE k = 'path_hash_rows') THEN
    RAISE EXCEPTION 'post-check: % path-hash checksum(s), expected %', n_bad,
      (SELECT v FROM rw_state WHERE k = 'path_hash_rows');
  END IF;

  SELECT count(*) INTO n_bad FROM (
    SELECT "ownerId", checksum FROM asset WHERE "libraryId" = lib
     GROUP BY "ownerId", checksum HAVING count(*) > 1) d;
  IF n_bad > 0 THEN
    RAISE EXCEPTION 'post-check: % duplicate (ownerId, libraryId, checksum) group(s)', n_bad;
  END IF;

  IF (SELECT "importPaths" FROM library WHERE id = lib) IS DISTINCT FROM ARRAY[new_p]::text[] THEN
    RAISE EXCEPTION 'post-check: importPaths is not {%}', new_p;
  END IF;

  -- Nothing outside this library's path rows may have changed.
  IF (SELECT coalesce(md5(string_agg(a::text, '|' ORDER BY a.id)), '')
        FROM asset a WHERE a."libraryId" IS DISTINCT FROM lib)
       <> (SELECT v FROM rw_state WHERE k = 'foreign_assets') THEN
    RAISE EXCEPTION 'post-check: an asset of another library changed';
  END IF;
  IF (SELECT coalesce(md5(string_agg(a::text, '|' ORDER BY a.id)), '')
        FROM asset a WHERE a."libraryId" = lib AND NOT starts_with(a."originalPath", new_p || '/'))
       <> (SELECT v FROM rw_state WHERE k = 'upload_assets') THEN
    RAISE EXCEPTION 'post-check: an Immich-managed asset of library % changed', lib;
  END IF;
  IF (SELECT coalesce(md5(string_agg(f::text, '|' ORDER BY f.id)), '')
        FROM asset_file f
       WHERE NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = f."assetId" AND a."libraryId" = lib))
       <> (SELECT v FROM rw_state WHERE k = 'foreign_files') THEN
    RAISE EXCEPTION 'post-check: an asset_file row of another library changed';
  END IF;
  IF (SELECT coalesce(md5(string_agg(r::text, '|' ORDER BY r.id)), '')
        FROM integrity_report r
       WHERE NOT EXISTS (SELECT 1 FROM asset a WHERE a.id = r."assetId" AND a."libraryId" = lib)
         AND NOT EXISTS (SELECT 1 FROM asset_file f JOIN asset a ON a.id = f."assetId"
                          WHERE f.id = r."fileAssetId" AND a."libraryId" = lib))
       <> (SELECT v FROM rw_state WHERE k = 'foreign_reports') THEN
    RAISE EXCEPTION 'post-check: an integrity_report row of another library changed';
  END IF;
  IF (SELECT coalesce(md5(string_agg(l::text, '|' ORDER BY l.id)), '')
        FROM library l WHERE l.id <> lib)
       <> (SELECT v FROM rw_state WHERE k = 'foreign_libraries') THEN
    RAISE EXCEPTION 'post-check: another library changed';
  END IF;

  RAISE NOTICE 'post-checks ok: % asset(s) under %/, none under %/, other libraries unchanged',
    n_new, new_p, old_p;
END $$;

-- Leave no extension behind when this transaction was the one to add it.
DO $$
BEGIN
  IF (SELECT v FROM rw_state WHERE k = 'created_pgcrypto') = 'yes' THEN
    DROP EXTENSION pgcrypto;
  END IF;
END $$;

\if :{?dry_run}
  \echo dry_run is set: rolling back
  ROLLBACK;
\else
  COMMIT;
\endif
