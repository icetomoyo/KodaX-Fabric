CREATE TYPE "sensitive_word_hit_action" AS ENUM ('detect', 'intercept');
--> statement-breakpoint
ALTER TABLE "sensitive_word_hits" ADD COLUMN "action" "sensitive_word_hit_action" DEFAULT 'detect' NOT NULL;
--> statement-breakpoint
CREATE INDEX "sensitive_word_hits_action_created_idx" ON "sensitive_word_hits" USING btree ("action","created_at");
