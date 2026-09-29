CREATE TABLE `arr_history_cursors` (
	`app` text PRIMARY KEY NOT NULL,
	`cursor_date` text NOT NULL,
	`cursor_ids` text NOT NULL,
	CONSTRAINT "arr_history_cursors_app_known" CHECK("arr_history_cursors"."app" IN ('radarr', 'sonarr'))
);
--> statement-breakpoint
CREATE TABLE `job_downloads` (
	`job_id` text NOT NULL,
	`app` text NOT NULL,
	`download_id` text NOT NULL,
	`grabbed_at` text,
	`imported_at` text,
	`failed_at` text,
	`fail_reason` text,
	`interactive` integer,
	PRIMARY KEY(`job_id`, `download_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "job_downloads_app_known" CHECK("job_downloads"."app" IN ('radarr', 'sonarr'))
);
--> statement-breakpoint
CREATE INDEX `job_downloads_app_download_id_idx` ON `job_downloads` (`app`,`download_id`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `status_note` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `upstream_command_id` integer;--> statement-breakpoint
ALTER TABLE `jobs` ADD `upstream_command_kind` text;--> statement-breakpoint
ALTER TABLE `jobs` ADD `upstream_command_at` text;