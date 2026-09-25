PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`actor_email` text,
	`actor_user_id` text,
	`actor_discord_user_id` text,
	`actor_discord_username` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_log_origin_matches_actor" CHECK((
        ("__new_audit_log"."origin" = 'web'     AND "__new_audit_log"."actor_email" IS NOT NULL         AND "__new_audit_log"."actor_user_id" IS NOT NULL
                                 AND "__new_audit_log"."actor_discord_user_id" IS NULL     AND "__new_audit_log"."actor_discord_username" IS NULL) OR
        ("__new_audit_log"."origin" = 'discord' AND "__new_audit_log"."actor_discord_user_id" IS NOT NULL AND "__new_audit_log"."actor_discord_username" IS NOT NULL
                                 AND "__new_audit_log"."actor_email" IS NULL             AND "__new_audit_log"."actor_user_id" IS NULL) OR
        ("__new_audit_log"."origin" = 'service' AND "__new_audit_log"."actor_email" IS NULL             AND "__new_audit_log"."actor_user_id" IS NULL
                                 AND "__new_audit_log"."actor_discord_user_id" IS NULL     AND "__new_audit_log"."actor_discord_username" IS NULL)
      )),
	CONSTRAINT "audit_log_target_pair" CHECK((
        ("__new_audit_log"."target_type" IS NULL     AND "__new_audit_log"."target_id" IS NULL) OR
        ("__new_audit_log"."target_type" IS NOT NULL AND "__new_audit_log"."target_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
-- HAND-EDITED. drizzle-kit generated this SELECT list by echoing the *new*
-- table's columns, including `actor_discord_user_id`/`actor_discord_username`
-- - which do not exist on the old `audit_log` and would make this statement
-- die with `no such column`. They are NULL for every pre-existing row (no
-- `origin = 'discord'` row can predate this migration), so they are selected
-- as literal NULLs here. Re-check this whenever a recreate migration is
-- regenerated alongside added columns.
INSERT INTO `__new_audit_log`("id", "origin", "actor_email", "actor_user_id", "actor_discord_user_id", "actor_discord_username", "action", "target_type", "target_id", "metadata", "created_at") SELECT "id", "origin", "actor_email", "actor_user_id", NULL, NULL, "action", "target_type", "target_id", "metadata", "created_at" FROM `audit_log`;--> statement-breakpoint
DROP TABLE `audit_log`;--> statement-breakpoint
ALTER TABLE `__new_audit_log` RENAME TO `audit_log`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `audit_log_created_at_id_idx` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_email_idx` ON `audit_log` (`actor_email`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_discord_user_id_idx` ON `audit_log` (`actor_discord_user_id`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`requester_email` text,
	`requester_user_id` text,
	`discord_user_id` text,
	`discord_username` text,
	`origin` text NOT NULL,
	`hidden_attribution` integer DEFAULT false NOT NULL,
	`error` text,
	`media_id` text NOT NULL,
	`scope` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT "jobs_origin_matches_requester" CHECK((
        ("__new_jobs"."origin" = 'web'     AND "__new_jobs"."requester_email" IS NOT NULL AND "__new_jobs"."requester_user_id" IS NOT NULL
                                 AND "__new_jobs"."discord_user_id" IS NULL      AND "__new_jobs"."discord_username" IS NULL) OR
        ("__new_jobs"."origin" = 'discord' AND "__new_jobs"."discord_user_id" IS NOT NULL  AND "__new_jobs"."discord_username" IS NOT NULL
                                 AND "__new_jobs"."requester_email" IS NULL     AND "__new_jobs"."requester_user_id" IS NULL) OR
        ("__new_jobs"."origin" = 'service' AND "__new_jobs"."requester_email" IS NULL     AND "__new_jobs"."requester_user_id" IS NULL
                                 AND "__new_jobs"."discord_user_id" IS NULL      AND "__new_jobs"."discord_username" IS NULL)
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
-- HAND-EDITED, same reason as the `__new_audit_log` copy above:
-- `discord_user_id`/`discord_username` do not exist on the old `jobs` table,
-- so they are selected as literal NULLs rather than as columns.
INSERT INTO `__new_jobs`("id", "type", "status", "requester_email", "requester_user_id", "discord_user_id", "discord_username", "origin", "hidden_attribution", "error", "media_id", "scope", "created_at", "updated_at", "completed_at") SELECT "id", "type", "status", "requester_email", "requester_user_id", NULL, NULL, "origin", "hidden_attribution", "error", "media_id", "scope", "created_at", "updated_at", "completed_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_requester_email_idx` ON `jobs` (`requester_email`);--> statement-breakpoint
CREATE INDEX `jobs_discord_user_id_idx` ON `jobs` (`discord_user_id`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_id_idx` ON `jobs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_type_media_id_idx` ON `jobs` (`type`,`media_id`);