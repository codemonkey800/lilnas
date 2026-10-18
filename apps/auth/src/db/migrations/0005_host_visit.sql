CREATE TABLE `host_visit` (
	`host` text NOT NULL,
	`user_id` text NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`host`, `user_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `host_visit_host_last_seen_idx` ON `host_visit` (`host`,`last_seen_at`);