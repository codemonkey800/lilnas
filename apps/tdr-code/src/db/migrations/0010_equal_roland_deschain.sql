-- NOTE: SQLite's PRAGMA foreign_keys cannot be changed inside an active
-- transaction (it silently no-ops). Drizzle's better-sqlite3 migrator runs
-- each migration file outside a wrapping transaction by default, so this
-- PRAGMA does take effect here. The INSERT INTO __new_events SELECT below
-- would still succeed even with FK checks ON because all existing event rows
-- reference valid generation/session ids (ON DELETE SET NULL / RESTRICT
-- guarantees no dangling FKs in the current schema). Verified: the migrator
-- is NOT wrapping this file in BEGIN...COMMIT before the PRAGMA fires.
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_events` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation_id` integer NOT NULL,
	`session_id` integer,
	`channel_id` text,
	`type` text NOT NULL,
	`level` text NOT NULL,
	`context` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "events_type_check" CHECK("__new_events"."type" IN ('session_created','session_evicted','turn_started','turn_completed','turn_cancelled','turn_errored','turn_interrupted','bot_restart','command_anomaly','transcript_write_failed','git_push_blocked','git_key_decrypt_failed','gh_blocked','github_token_decrypt_failed')),
	CONSTRAINT "events_level_check" CHECK("__new_events"."level" IN ('info','warn','error'))
);
--> statement-breakpoint
INSERT INTO `__new_events`("id", "generation_id", "session_id", "channel_id", "type", "level", "context", "created_at") SELECT "id", "generation_id", "session_id", "channel_id", "type", "level", "context", "created_at" FROM `events`;--> statement-breakpoint
DROP TABLE `events`;--> statement-breakpoint
ALTER TABLE `__new_events` RENAME TO `events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `events_created_at_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_channel_created_idx` ON `events` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);