import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  conversationItems,
  conversationStatus,
  conversations,
  executionStatus,
  integrationAccounts,
  integrationOauthStates,
  itemRole,
  toolExecutions,
  userProfiles,
} from "./schema.js";

const schema = {
  conversationItems,
  conversationStatus,
  conversations,
  executionStatus,
  integrationAccounts,
  integrationOauthStates,
  itemRole,
  toolExecutions,
  userProfiles,
};

export type Database = ReturnType<typeof createDatabase>;

export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const client = postgres(url, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false,
  });

  return drizzle({ client, schema });
}
