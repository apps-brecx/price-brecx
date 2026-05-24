import { randomBytes, createHash } from "node:crypto";
import bcrypt from "bcryptjs";
import { sql } from "../db.js";

const SESSION_TTL_DAYS = 30;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  workspaceId: string;
}

export async function createSession(
  userId: string,
  meta?: { ip?: string | null; userAgent?: string | null },
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000);
  await sql`
    insert into sessions (token_hash, user_id, expires_at, ip, user_agent)
    values (${tokenHash}, ${userId}, ${expiresAt},
            ${meta?.ip ?? null}, ${meta?.userAgent ?? null})
  `;
  return token;
}

/** Bump last_seen_at on the active session so the Security page's session
 *  list shows when each device was last used. Best-effort — failures are
 *  swallowed so a transient DB error never breaks an authenticated request. */
export async function touchSession(token: string | undefined): Promise<void> {
  if (!token) return;
  try {
    await sql`
      update sessions set last_seen_at = now()
       where token_hash = ${hashToken(token)}
    `;
  } catch {
    /* non-critical, ignore */
  }
}

/** Public form of hashToken for callers that need to identify a session by
 *  its plaintext token cookie without re-implementing the SHA-256 step. */
export function tokenFingerprint(token: string): string {
  return hashToken(token);
}

export async function resolveSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (!token) return null;
  const tokenHash = hashToken(token);
  const rows = await sql<SessionUser[]>`
    select u.id, u.email, u.name, u.role, u.workspace_id as "workspaceId"
    from sessions s
    join users u on u.id = s.user_id
    where s.token_hash = ${tokenHash}
      and s.expires_at > now()
    limit 1
  `;
  return rows[0] ?? null;
}

export async function destroySession(token: string | undefined): Promise<void> {
  if (!token) return;
  await sql`delete from sessions where token_hash = ${hashToken(token)}`;
}
