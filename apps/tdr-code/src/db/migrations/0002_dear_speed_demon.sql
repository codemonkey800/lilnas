CREATE TABLE `events` (
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
	CONSTRAINT "events_type_check" CHECK("events"."type" IN ('session_created','session_evicted','turn_started','turn_completed','turn_cancelled','turn_errored','turn_interrupted','bot_restart','command_anomaly')),
	CONSTRAINT "events_level_check" CHECK("events"."level" IN ('info','warn','error'))
);
--> statement-breakpoint
CREATE INDEX `events_created_at_idx` ON `events` (`created_at`);--> statement-breakpoint
CREATE INDEX `events_channel_created_idx` ON `events` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_session_idx` ON `events` (`session_id`);--> statement-breakpoint
CREATE INDEX `events_type_idx` ON `events` (`type`);--> statement-breakpoint
CREATE TABLE `live_status` (
	`channel_id` text PRIMARY KEY NOT NULL,
	`generation_id` integer NOT NULL,
	`triggering_user_id` text,
	`prompting` integer NOT NULL,
	`queue_depth` integer NOT NULL,
	`last_activity_at` integer NOT NULL,
	`last_heartbeat_at` integer NOT NULL,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "live_status_prompting_check" CHECK("live_status"."prompting" IN (0,1)),
	CONSTRAINT "live_status_queue_depth_check" CHECK("live_status"."queue_depth" >= 0)
);
--> statement-breakpoint
CREATE INDEX `live_status_generation_idx` ON `live_status` (`generation_id`);