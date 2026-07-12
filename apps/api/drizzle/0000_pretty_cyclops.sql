CREATE TYPE "public"."conversation_status" AS ENUM('active', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tool_execution_status" AS ENUM('running', 'succeeded', 'failed', 'timed_out');--> statement-breakpoint
CREATE TYPE "public"."conversation_item_role" AS ENUM('user', 'assistant', 'tool');--> statement-breakpoint
CREATE TABLE "conversation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"role" "conversation_item_role" NOT NULL,
	"kind" text NOT NULL,
	"transcript" text,
	"call_id" text,
	"payload" jsonb,
	"completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"realtime_session_id" text,
	"status" "conversation_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"encrypted_credentials" text NOT NULL,
	"encryption_iv" text NOT NULL,
	"encryption_tag" text NOT NULL,
	"encryption_key_version" text NOT NULL,
	"expires_at" timestamp with time zone,
	"scopes" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tool_executions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_id" uuid,
	"request_id" text NOT NULL,
	"call_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"status" "tool_execution_status" DEFAULT 'running' NOT NULL,
	"arguments" jsonb,
	"result" jsonb,
	"error_code" text,
	"retryable" boolean,
	"duration_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_items" ADD CONSTRAINT "conversation_items_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_user_id_user_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_executions" ADD CONSTRAINT "tool_executions_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_items_order_idx" ON "conversation_items" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE INDEX "conversations_user_idx" ON "conversations" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_user_provider_idx" ON "integration_accounts" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "tool_execution_idempotency_idx" ON "tool_executions" USING btree ("user_id","call_id");--> statement-breakpoint
CREATE INDEX "tool_execution_audit_idx" ON "tool_executions" USING btree ("user_id","created_at");