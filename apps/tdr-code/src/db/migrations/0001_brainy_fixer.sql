CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY NOT NULL,
	`channel_id` text NOT NULL,
	`generation_id` integer NOT NULL,
	`triggering_user_id` text NOT NULL,
	`acp_session_id` text,
	`cwd` text NOT NULL,
	`created_at` integer NOT NULL,
	`ended_at` integer,
	`end_reason` text,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sessions_end_reason_check" CHECK("sessions"."end_reason" IN ('evicted','teardown','interrupted')),
	CONSTRAINT "sessions_ended_correlation_check" CHECK(("sessions"."ended_at" IS NULL) = ("sessions"."end_reason" IS NULL))
);
--> statement-breakpoint
CREATE INDEX `sessions_channel_created_idx` ON `sessions` (`channel_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `sessions_generation_idx` ON `sessions` (`generation_id`);--> statement-breakpoint
CREATE INDEX `sessions_active_lookup_idx` ON `sessions` (`channel_id`,`created_at`) WHERE "sessions"."ended_at" IS NULL;--> statement-breakpoint
CREATE TABLE `turn_content` (
	`id` integer PRIMARY KEY NOT NULL,
	`turn_id` integer NOT NULL,
	`ref` text,
	`kind` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "turn_content_kind_check" CHECK("turn_content"."kind" IN ('prompt','agent_text','tool_call','diff'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turn_content_ref_unique_idx` ON `turn_content` (`turn_id`,`ref`) WHERE "turn_content"."ref" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `turn_content_turn_idx` ON `turn_content` (`turn_id`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` integer PRIMARY KEY NOT NULL,
	`session_id` integer NOT NULL,
	`generation_id` integer NOT NULL,
	`turn_index` integer NOT NULL,
	`user_id` text,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`stop_reason` text,
	`status` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "turns_status_check" CHECK("turns"."status" IN ('running','completed','cancelled','errored','interrupted')),
	CONSTRAINT "turns_status_ended_correlation_check" CHECK(("turns"."status" = 'running') = ("turns"."ended_at" IS NULL)),
	CONSTRAINT "turns_turn_index_positive_check" CHECK("turns"."turn_index" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `turns_session_turn_index_unique_idx` ON `turns` (`session_id`,`turn_index`);--> statement-breakpoint
CREATE INDEX `turns_dangling_sweep_idx` ON `turns` (`generation_id`) WHERE "turns"."ended_at" IS NULL;