CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lilnas_user_id" text NOT NULL,
	"lilnas_email" text NOT NULL,
	"slug" text NOT NULL,
	"apple_id" text,
	"immich_user_id" text,
	"immich_library_id" text,
	"immich_email" text,
	"immich_created_by_us" boolean DEFAULT false NOT NULL,
	"total_items" integer DEFAULT 0 NOT NULL,
	"total_bytes" bigint DEFAULT 0 NOT NULL,
	"last_backup_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_lilnas_user_id_unique" UNIQUE("lilnas_user_id"),
	CONSTRAINT "accounts_slug_unique" UNIQUE("slug"),
	CONSTRAINT "accounts_apple_id_unique" UNIQUE("apple_id")
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"job_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"type" text NOT NULL,
	"message" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"auth_error" text,
	"total_items" integer,
	"downloaded_items" integer DEFAULT 0 NOT NULL,
	"skipped_items" integer DEFAULT 0 NOT NULL,
	"downloaded_bytes" bigint DEFAULT 0 NOT NULL,
	"current_file" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"error_code" text,
	"error_detail" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_one_active_per_account" ON "jobs" USING btree ("account_id") WHERE "jobs"."state" not in ('done', 'needs_login', 'paused_low_disk', 'failed', 'cancelled');--> statement-breakpoint
CREATE INDEX "jobs_account_started_idx" ON "jobs" USING btree ("account_id","started_at");