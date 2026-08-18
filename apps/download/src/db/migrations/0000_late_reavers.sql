CREATE TABLE `jobs` (
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
        ("jobs"."origin" = 'web'     AND "jobs"."requester_email" IS NOT NULL AND "jobs"."requester_user_id" IS NOT NULL) OR
        ("jobs"."origin" = 'service' AND "jobs"."requester_email" IS NULL     AND "jobs"."requester_user_id" IS NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`);--> statement-breakpoint
CREATE INDEX `jobs_requester_email_idx` ON `jobs` (`requester_email`);--> statement-breakpoint
CREATE INDEX `jobs_created_at_idx` ON `jobs` (`created_at`);