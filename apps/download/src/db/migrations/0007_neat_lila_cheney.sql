CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`origin` text NOT NULL,
	`actor_email` text,
	`actor_user_id` text,
	`action` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`metadata` text,
	`created_at` integer NOT NULL,
	CONSTRAINT "audit_log_origin_matches_actor" CHECK((
        ("audit_log"."origin" = 'web'     AND "audit_log"."actor_email" IS NOT NULL AND "audit_log"."actor_user_id" IS NOT NULL) OR
        ("audit_log"."origin" = 'service' AND "audit_log"."actor_email" IS NULL     AND "audit_log"."actor_user_id" IS NULL)
      )),
	CONSTRAINT "audit_log_target_pair" CHECK((
        ("audit_log"."target_type" IS NULL     AND "audit_log"."target_id" IS NULL) OR
        ("audit_log"."target_type" IS NOT NULL AND "audit_log"."target_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE INDEX `audit_log_created_at_id_idx` ON `audit_log` (`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `audit_log_actor_email_idx` ON `audit_log` (`actor_email`);--> statement-breakpoint
CREATE INDEX `audit_log_action_idx` ON `audit_log` (`action`);