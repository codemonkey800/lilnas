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
CREATE INDEX `bad_files_media_id_idx` ON `bad_files` (`media_id`);