CREATE TABLE `github_credential` (
	`user_id` text PRIMARY KEY NOT NULL,
	`github_user_id` text NOT NULL,
	`github_login` text NOT NULL,
	`derived_name` text NOT NULL,
	`derived_email` text NOT NULL,
	`token_ciphertext` blob NOT NULL,
	`token_iv` blob NOT NULL,
	`token_auth_tag` blob NOT NULL,
	`scope` text NOT NULL,
	`master_key_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
