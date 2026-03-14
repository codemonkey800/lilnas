ALTER TABLE "download_search_result" ALTER COLUMN "tmdb_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tmdb_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tvdb_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tvdb_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "season_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "season_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "episode_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "episode_number" SET NOT NULL;