CREATE TABLE `media_file_releases` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` text NOT NULL,
	`upstream_file_id` integer NOT NULL,
	`episode_id` integer,
	`release_guid` text NOT NULL,
	`indexer_id` integer,
	`indexer` text,
	`release_title` text,
	`download_id` text,
	`protocol` text,
	`publish_date` integer,
	`size` integer,
	`release_group` text,
	`resolved_at` integer NOT NULL,
	CONSTRAINT "media_file_releases_media_id_matches_type" CHECK((
        ("media_file_releases"."media_type" = 'movie' AND "media_file_releases"."media_id" LIKE 'tmdb:%') OR
        ("media_file_releases"."media_type" = 'show'  AND "media_file_releases"."media_id" LIKE 'tvdb:%')
      )),
	CONSTRAINT "media_file_releases_episode_only_for_shows" CHECK(("media_file_releases"."episode_id" IS NULL OR "media_file_releases"."media_type" = 'show'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_file_releases_type_file_idx` ON `media_file_releases` (`media_type`,`upstream_file_id`);--> statement-breakpoint
CREATE INDEX `media_file_releases_media_id_idx` ON `media_file_releases` (`media_id`);