PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_commands` (
	`id` integer PRIMARY KEY NOT NULL,
	`generation_id` integer NOT NULL,
	`type` text NOT NULL,
	`target` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`generation_id`) REFERENCES `bot_generation`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "commands_type_check" CHECK("__new_commands"."type" IN ('teardown_channel','reread_config')),
	CONSTRAINT "commands_status_check" CHECK("__new_commands"."status" IN ('pending','consumed'))
);
--> statement-breakpoint
INSERT INTO `__new_commands`("id", "generation_id", "type", "target", "status", "created_at", "consumed_at") SELECT "id", "generation_id", "type", "target", "status", "created_at", "consumed_at" FROM `commands`;--> statement-breakpoint
DROP TABLE `commands`;--> statement-breakpoint
ALTER TABLE `__new_commands` RENAME TO `commands`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `commands_generation_status_idx` ON `commands` (`generation_id`,`status`);