ALTER TABLE "reminder" ADD COLUMN "user_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "schedule_description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "source" text DEFAULT 'discord' NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "last_run_at" timestamp;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "run_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "reminder" ADD COLUMN "cancelled_at" timestamp;--> statement-breakpoint
UPDATE "reminder" SET "schedule_description" = trim(concat_ws(' ', "day_description", "time_description"));--> statement-breakpoint
UPDATE "reminder" SET "next_run_at" = "scheduled_at" WHERE "is_recurring" = false;--> statement-breakpoint
CREATE INDEX "reminder_status_next_run_at_idx" ON "reminder" USING btree ("status","next_run_at");--> statement-breakpoint
CREATE INDEX "reminder_user_id_idx" ON "reminder" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "reminder" DROP COLUMN "day_description";--> statement-breakpoint
ALTER TABLE "reminder" DROP COLUMN "time_description";