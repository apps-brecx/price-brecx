import postgres from "postgres";
import { env, isProd } from "./env.js";

/**
 * Single shared postgres.js client. Neon requires TLS. We let `sslmode` in the
 * connection string drive TLS (postgres.js maps it to the `ssl` option), and
 * additionally force `ssl: "require"` in prod as a safeguard.
 *
 * NOTE: the `ssl` key must be *absent* (not `undefined`) when we want the URL to
 * decide — postgres.js treats `"ssl" in options` as "explicitly set" and will
 * not fall back to the connection string's `sslmode`.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: isProd ? 10 : 5,
  idle_timeout: 20,
  max_lifetime: 60 * 30,
  ...(isProd ? { ssl: "require" as const } : {}),
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
