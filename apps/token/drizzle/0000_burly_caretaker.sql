CREATE TABLE "token" (
	"id" text PRIMARY KEY NOT NULL,
	"app_slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
