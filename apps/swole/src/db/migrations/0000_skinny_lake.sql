CREATE TABLE `exercises` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_id` integer NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`order_in_routine` integer NOT NULL,
	`sets` integer NOT NULL,
	`target_reps` integer,
	`starting_weight` integer,
	`increment` integer,
	`duration_seconds` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "exercise_type_fields_match" CHECK((
        ("exercises"."type" = 'weighted'    AND "exercises"."target_reps" IS NOT NULL AND "exercises"."starting_weight" IS NOT NULL AND "exercises"."increment" IS NOT NULL AND "exercises"."duration_seconds" IS NULL) OR
        ("exercises"."type" = 'bodyweight'  AND "exercises"."target_reps" IS NOT NULL AND "exercises"."starting_weight" IS NULL     AND "exercises"."increment" IS NULL     AND "exercises"."duration_seconds" IS NULL) OR
        ("exercises"."type" = 'time-based'  AND "exercises"."target_reps" IS NULL     AND "exercises"."starting_weight" IS NULL     AND "exercises"."increment" IS NULL     AND "exercises"."duration_seconds" IS NOT NULL) OR
        ("exercises"."type" = 'cardio'      AND "exercises"."target_reps" IS NULL     AND "exercises"."starting_weight" IS NULL     AND "exercises"."increment" IS NULL     AND "exercises"."duration_seconds" IS NOT NULL AND "exercises"."sets" = 1)
      )),
	CONSTRAINT "exercise_sets_positive" CHECK("exercises"."sets" >= 1)
);
--> statement-breakpoint
CREATE TABLE `progressions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`exercise_id` integer NOT NULL,
	`session_id` integer,
	`starting_weight` integer NOT NULL,
	`reason` text NOT NULL,
	`effective_from` integer NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `routines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`days` text NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`routine_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`routine_id`) REFERENCES `routines`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_session_per_routine` ON `sessions` (`routine_id`) WHERE "sessions"."completed_at" IS NULL;--> statement-breakpoint
CREATE TABLE `set_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`exercise_id` integer NOT NULL,
	`set_number` integer NOT NULL,
	`weight` integer,
	`target_reps` integer,
	`actual_reps` integer,
	`duration_seconds` integer,
	`actual_duration_seconds` integer,
	`action` text NOT NULL,
	`logged_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "set_number_one_indexed" CHECK("set_logs"."set_number" >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `set_logs_session_exercise_set_unique` ON `set_logs` (`session_id`,`exercise_id`,`set_number`);