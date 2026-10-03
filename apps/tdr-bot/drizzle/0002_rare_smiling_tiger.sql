CREATE TABLE "bot_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"models" jsonb,
	"temperature" real,
	"reasoning_effort" text,
	"system_prompt" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
