-- HAND-EDITED (plan 021, docs/features/download/plans/021-media-as-source-of-truth.md,
-- "The cleanup migration"). drizzle-kit generated only the DROP COLUMN below;
-- the DELETE is prepended by hand.
--
-- The DELETE removes the fake `completed` jobs `syncDownloadedLibrary()`
-- (`library-sync.ts`, now deleted) backfilled at boot for every Radarr/Sonarr
-- title with a file. The gallery is built from the library now, so those rows
-- are dead weight. They carry `origin = 'service'`, `status = 'completed'`,
-- NULL requesters and - the tell - `created_at = completed_at = entry.addedAt`.
-- A real service-origin job (a tdr-bot call with no identity) always has
-- `created_at < completed_at`, and was never a movie or show on prod.
--
-- Read-only counts on 2026-09-22: dev has 357 such rows (283 movie + 74 show),
-- all matching; prod has 21 service-origin completed rows, all type video, 0
-- with created_at = completed_at - so this deletes every backfilled row on dev
-- and nothing on prod. No `audit_log` row references any of them.
--
-- `removed_from_library` (added by 0003) is referenced by no index or CHECK,
-- so a plain DROP COLUMN is safe on SQLite - no table rebuild needed.
DELETE FROM `jobs` WHERE `origin` = 'service' AND `status` = 'completed'
  AND `type` IN ('movie', 'show') AND `created_at` = `completed_at`;
--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `removed_from_library`;
