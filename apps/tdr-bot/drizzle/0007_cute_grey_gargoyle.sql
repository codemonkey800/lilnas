CREATE TABLE "emoji_dictionary" (
	"id" text PRIMARY KEY NOT NULL,
	"guild_id" text NOT NULL,
	"name" text NOT NULL,
	"animated" boolean DEFAULT false NOT NULL,
	"description" text,
	"source" text,
	"model" text,
	"described_at" timestamp,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "emoji_dictionary_guild_id_idx" ON "emoji_dictionary" USING btree ("guild_id");