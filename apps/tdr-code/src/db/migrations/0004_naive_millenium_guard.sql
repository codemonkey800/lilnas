CREATE TABLE `config` (
	`id` integer PRIMARY KEY NOT NULL,
	`cwd` text NOT NULL,
	`claude_command` text NOT NULL,
	`claude_args` text NOT NULL,
	`idle_timeout_sec` integer NOT NULL,
	`max_concurrent_sessions` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "config_single_row_check" CHECK("config"."id" = 1),
	CONSTRAINT "config_idle_timeout_check" CHECK("config"."idle_timeout_sec" > 0),
	CONSTRAINT "config_max_sessions_check" CHECK("config"."max_concurrent_sessions" >= 1)
);
--> statement-breakpoint
CREATE TABLE `git_identity` (
	`discord_user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`key_ciphertext` blob NOT NULL,
	`key_iv` blob NOT NULL,
	`key_auth_tag` blob NOT NULL,
	`key_fingerprint` text NOT NULL,
	`key_version` integer DEFAULT 1 NOT NULL,
	`master_key_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
