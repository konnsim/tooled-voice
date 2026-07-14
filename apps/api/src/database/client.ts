import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';
export type Database = ReturnType<typeof createDatabase>;
export function createDatabase(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('DATABASE_URL is required');
  const client = postgres(url, {
    connect_timeout: 10,
    idle_timeout: 20,
    max: 5,
    prepare: false,
  });
  return drizzle({ client, schema });
}
