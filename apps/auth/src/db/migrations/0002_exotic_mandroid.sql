CREATE TABLE `discord_identity` (
	`discord_user_id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`display_name` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `discord_link` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`discord_user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`discord_user_id`) REFERENCES `discord_identity`(`discord_user_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `discord_link_user_id_unique_idx` ON `discord_link` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `discord_link_discord_user_id_unique_idx` ON `discord_link` (`discord_user_id`);