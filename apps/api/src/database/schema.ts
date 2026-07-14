import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Default-deny RLS and the auth.users FK are maintained in custom migrations
// because the installed Drizzle Kit does not execute pgTable.withRLS.
const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
};
export const conversationStatus = pgEnum("conversation_status", [
  "active",
  "completed",
  "failed",
]);
export const itemRole = pgEnum("conversation_item_role", [
  "user",
  "assistant",
  "tool",
]);
export const executionStatus = pgEnum("tool_execution_status", [
  "running",
  "succeeded",
  "failed",
  "timed_out",
]);
export const userProfiles = pgTable("user_profiles", {
  displayName: text("display_name"),
  id: uuid("id").primaryKey(),
  toolApprovalPolicy: text("tool_approval_policy").default("ask").notNull(),
  toolSettings: jsonb("tool_settings").default({}).notNull(),
  ...timestamps,
});
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    realtimeSessionId: text("realtime_session_id"),
    status: conversationStatus().default("active").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [index("conversations_user_idx").on(t.userId)]
);
export const conversationItems = pgTable(
  "conversation_items",
  {
    callId: text("call_id"),
    completed: boolean("completed").default(false).notNull(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    id: uuid("id").defaultRandom().primaryKey(),
    kind: text("kind").notNull(),
    payload: jsonb("payload"),
    role: itemRole().notNull(),
    sequence: integer("sequence").notNull(),
    transcript: text("transcript"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("conversation_items_order_idx").on(
      t.conversationId,
      t.sequence
    ),
  ]
);
export const integrationAccounts = pgTable(
  "integration_accounts",
  {
    approvalPolicy: text("approval_policy").default("ask").notNull(),
    encryptedCredentials: text("encrypted_credentials").notNull(),
    encryptionIv: text("encryption_iv").notNull(),
    encryptionKeyVersion: text("encryption_key_version").notNull(),
    encryptionTag: text("encryption_tag").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    scopes: text("scopes").array(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("integration_user_provider_idx").on(t.userId, t.provider)]
);
export const integrationOauthStates = pgTable(
  "integration_oauth_states",
  {
    codeVerifier: text("code_verifier").notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    id: uuid("id").defaultRandom().primaryKey(),
    provider: text("provider").notNull(),
    redirectUri: text("redirect_uri").notNull(),
    stateHash: text("state_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userProfiles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("integration_oauth_state_hash_idx").on(t.stateHash),
    index("integration_oauth_state_user_idx").on(t.userId, t.provider),
  ]
);
export const toolExecutions = pgTable(
  "tool_executions",
  {
    arguments: jsonb("arguments"),
    callId: text("call_id").notNull(),
    conversationId: uuid("conversation_id").references(() => conversations.id),
    durationMs: integer("duration_ms"),
    errorCode: text("error_code"),
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: text("request_id").notNull(),
    result: jsonb("result"),
    retryable: boolean("retryable"),
    status: executionStatus().default("running").notNull(),
    toolName: text("tool_name").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => userProfiles.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("tool_execution_idempotency_idx").on(t.userId, t.callId),
    index("tool_execution_audit_idx").on(t.userId, t.createdAt),
    index("tool_execution_conversation_idx").on(t.conversationId),
  ]
);
