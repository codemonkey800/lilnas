CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`actor_email` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_log_origin_matches_actor" CHECK((
        ("audit_log"."origin" = 'web'     AND "audit_log"."actor_email" IS NOT NULL AND "audit_log"."actor_user_id" IS NOT NULL) OR
        ("audit_log"."origin" = 'service' AND "audit_log"."actor_email" IS NULL     AND "audit_log"."actor_user_id" IS NULL)
      )),
	CONSTRAINT "audit_log_target_pair" CHECK((
        ("audit_log"."target_type" IS NULL     AND "audit_log"."target_id" IS NULL) OR
        ("audit_log"."target_type" IS NOT NULL AND "audit_log"."target_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_id_idx` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_email_idx` ON `audit_log` (`actor_email`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);--> statement-breakpoint
CREATE TABLE `bad_files` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`release_guid` text NOT NULL,
	`indexer_id` integer,
	`release_title` text,
	`reason` text,
	`flagged_by_email` text NOT NULL,
	`flagged_by_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "bad_files_media_id_matches_type" CHECK((
        ("bad_files"."media_type" = 'movie' AND "bad_files"."media_id" LIKE 'tmdb:%') OR
        ("bad_files"."media_type" = 'show'  AND "bad_files"."media_id" LIKE 'tvdb:%')
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `bad_files_media_id_release_guid_idx` ON `bad_files` (`media_id`,`release_guid`);--> statement-breakpoint
CREATE INDEX `bad_files_media_id_idx` ON `bad_files` (`media_id`);--> statement-breakpoint
CREATE TABLE `jobs` (
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
        ("jobs"."origin" = 'web'     AND "jobs"."requester_email" IS NOT NULL AND "jobs"."requester_user_id" IS NOT NULL) OR
        ("jobs"."origin" = 'service' AND "jobs"."requester_email" IS NULL     AND "jobs"."requester_user_id" IS NULL)
      )),
	CONSTRAINT "jobs_media_id_matches_type" CHECK((
        "jobs"."media_id" IS NULL OR
        ("jobs"."type" = 'movie' AND "jobs"."media_id" LIKE 'tmdb:%') OR
        ("jobs"."type" = 'show'  AND "jobs"."media_id" LIKE 'tvdb:%') OR
        ("jobs"."type" = 'video' AND "jobs"."media_id" LIKE 'video:%')
      )),
	CONSTRAINT "jobs_scope_only_for_shows" CHECK(("jobs"."scope" IS NULL OR "jobs"."type" = 'show'))
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_requester_email_idx` ON `jobs` (`requester_email`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_id_idx` ON `jobs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_type_media_id_idx` ON `jobs` (`type`,`media_id`);--> statement-breakpoint
CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`natural_key` text NOT NULL,
	`source_url` text NOT NULL,
	`time_range` text,
	`title` text NOT NULL,
	`overview` text,
	`poster_url` text,
	`runtime` integer,
	`download_urls` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_natural_key_idx` ON `videos` (`natural_key`);