import postgres from "postgres";
import { env, isProd } from "./env.js";

/**
 * Single shared postgres.js client. Neon requires TLS; `sslmode=require` in the
 * connection string is honoured, and we also opt into TLS explicitly in prod.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: isProd ? 10 : 5,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  ssl: isProd ? "require" : undefined,
  transform: { undefined: null },
});

export type Sql = typeof sql;

/** Wrap a value for a jsonb column (postgres.js json() has a strict type). */
export function jsonb(value: unknown) {
  return sql.json(value as never);
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
