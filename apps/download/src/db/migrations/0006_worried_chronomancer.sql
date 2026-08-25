-- Phase 4: `jobs.scope`. SQLite can't attach a CHECK to an existing table
-- with ALTER TABLE, so drizzle-kit emits the standard 12-step table rebuild
-- for `jobs_scope_only_for_shows`.
--
-- HAND-EDITED: drizzle-kit generated the copy step as
-- `INSERT INTO __new_jobs(..., "scope", ...) SELECT ..., "scope", ... FROM jobs`,
-- selecting a column the *old* table doesn't have yet - which fails with
-- `no such column: "scope"` and takes every migration run down with it. The
-- SELECT below reads `NULL` in that position instead. Every other column is
-- copied through unchanged, and all five indexes are recreated at the end.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`requester_email` text,
	`requester_user_id` text,
	`origin` text NOT NULL,
	`hidden_attribution` integer DEFAULT false NOT NULL,
	`error` text,
	`media_id` text NOT NULL,
	`scope` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "jobs_origin_matches_requester" CHECK((
        ("__new_jobs"."origin" = 'web'     AND "__new_jobs"."requester_email" IS NOT NULL AND "__new_jobs"."requester_user_id" IS NOT NULL) OR
        ("__new_jobs"."origin" = 'service' AND "__new_jobs"."requester_email" IS NULL     AND "__new_jobs"."requester_user_id" IS NULL)
      )),
	CONSTRAINT "jobs_media_id_matches_type" CHECK((
        "__new_jobs"."media_id" IS NULL OR
        ("__new_jobs"."type" = 'movie' AND "__new_jobs"."media_id" LIKE 'tmdb:%') OR
        ("__new_jobs"."type" = 'show'  AND "__new_jobs"."media_id" LIKE 'tvdb:%') OR
        ("__new_jobs"."type" = 'video' AND "__new_jobs"."media_id" LIKE 'video:%')
      )),
	CONSTRAINT "jobs_scope_only_for_shows" CHECK(("__new_jobs"."scope" IS NULL OR "__new_jobs"."type" = 'show'))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "type", "status", "requester_email", "requester_user_id", "origin", "hidden_attribution", "error", "media_id", "scope", "created_at", "updated_at", "completed_at") SELECT "id", "type", "status", "requester_email", "requester_user_id", "origin", "hidden_attribution", "error", "media_id", NULL, "created_at", "updated_at", "completed_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_requester_email_idx` ON `jobs` (`requester_email`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_id_idx` ON `jobs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_type_media_id_idx` ON `jobs` (`type`,`media_id`);