CREATE TABLE `pre_authorized_grant` (
	`id` integer PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`service_host` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pre_authorized_grant_email_service_unique_idx` ON `pre_authorized_grant` (`email`,`service_host`);--> statement-breakpoint
CREATE INDEX `pre_authorized_grant_email_idx` ON `pre_authorized_grant` (`email`);--> statement-breakpoint
ALTER TABLE `user` ADD `ever_granted_at` integer;