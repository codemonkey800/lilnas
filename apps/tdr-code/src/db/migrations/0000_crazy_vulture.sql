CREATE TABLE `bot_generation` (
	`id` integer PRIMARY KEY NOT NULL,
	`started_at` integer NOT NULL,
	`status` text NOT NULL,
	`pid` integer,
	`last_heartbeat_at` integer,
	`ended_at` integer,
	`exit_code` integer,
	CONSTRAINT "bot_generation_status_check" CHECK("bot_generation"."status" IN ('starting','running','stopping','stopped','crashed','failed'))
);
--> statement-breakpoint
CREATE TABLE `claude_process` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation_id` integer NOT NULL,
	`pgid` integer NOT NULL,
	`channel_id` text,
	`spawned_at` integer NOT NULL,
	`exited_at` integer,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `claude_process_live_idx` ON `claude_process` (`generation_id`);--> statement-breakpoint
CREATE TABLE `commands` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation_id` integer NOT NULL,
	`type` text NOT NULL,
	`target` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "commands_type_check" CHECK("commands"."type" IN ('teardown_channel')),
	CONSTRAINT "commands_status_check" CHECK("commands"."status" IN ('pending','consumed'))
);
--> statement-breakpoint
CREATE INDEX `commands_generation_status_idx` ON `commands` (`generation_id`,`status`);