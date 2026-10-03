CREATE TABLE "llm_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"channel_id" text,
	"user_id" text,
	"skill" text,
	"operation" text NOT NULL,
	"model" text NOT NULL,
	"role" text,
	"status" text NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cached_tokens" integer,
	"cost_usd" numeric(10, 6),
	"duration_ms" integer,
	"retries" integer,
	"finish_reason" text,
	"prompt_hash" text,
	"prompt" jsonb,
	"output" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "llm_calls_channel_id_created_at_idx" ON "llm_calls" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "llm_calls_created_at_idx" ON "llm_calls" USING btree ("created_at");