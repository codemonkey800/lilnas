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
CREATE UNIQUE INDEX `videos_natural_key_idx` ON `videos` (`natural_key`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`requester_email` text,
	`requester_user_id` text,
	`origin` text NOT NULL,
	`hidden_attribution` integer DEFAULT false NOT NULL,
	`url` text NOT NULL,
	`title` text,
	`description` text,
	`error` text,
	`media_id` text,
	`media_title` text,
	`poster_url` text,
	`overview` text,
	`radarr_id` integer,
	`sonarr_id` integer,
	`queue_snapshot` text,
	`time_range` text,
	`download_urls` text,
	`file_path` text,
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
      ))
);
--> statement-breakpoint
INSERT INTO `__new_jobs`("id", "type", "status", "requester_email", "requester_user_id", "origin", "hidden_attribution", "url", "title", "description", "error", "media_title", "poster_url", "overview", "radarr_id", "sonarr_id", "queue_snapshot", "time_range", "download_urls", "file_path", "created_at", "updated_at", "completed_at") SELECT "id", "type", "status", "requester_email", "requester_user_id", "origin", "hidden_attribution", "url", "title", "description", "error", "media_title", "poster_url", "overview", "radarr_id", "sonarr_id", "queue_snapshot", "time_range", "download_urls", "file_path", "created_at", "updated_at", "completed_at" FROM `jobs`;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_requester_email_idx` ON `jobs` (`requester_email`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_id_idx` ON `jobs` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `jobs_type_media_id_idx` ON `jobs` (`type`,`media_id`);