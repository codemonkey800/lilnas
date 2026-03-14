UPDATE "download_search_result" SET "tmdb_id" = 0 WHERE "tmdb_id" IS NULL;--> statement-breakpoint
UPDATE "download_search_result" SET "tvdb_id" = 0 WHERE "tvdb_id" IS NULL;--> statement-breakpoint
UPDATE "download_search_result" SET "season_number" = 0 WHERE "season_number" IS NULL;--> statement-breakpoint
UPDATE "download_search_result" SET "episode_number" = 0 WHERE "episode_number" IS NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tmdb_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tmdb_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tvdb_id" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "tvdb_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "season_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "season_number" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "episode_number" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "download_search_result" ALTER COLUMN "episode_number" SET NOT NULL;
