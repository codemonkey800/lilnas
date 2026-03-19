CREATE TABLE "reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"guild_id" text DEFAULT '' NOT NULL,
	"what" text NOT NULL,
	"is_recurring" boolean DEFAULT false NOT NULL,
	"cron_expression" text,
	"scheduled_at" timestamp,
	"day_description" text NOT NULL,
	"time_description" text NOT NULL,
	"channel_id" text,
	"action_type" text DEFAULT 'default' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
