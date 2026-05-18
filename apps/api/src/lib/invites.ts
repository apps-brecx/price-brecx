import { randomBytes, createHash } from "node:crypto";

/**
 * Invite tokens use the same scheme as session tokens (sessions.ts):
 * a 32-byte random value handed to the user, only its sha256 hash stored.
 * The raw token never touches the database.
 */
export const INVITE_TTL_DAYS = 7;

export function newInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInviteToken(token) };
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function inviteExpiry(): Date {
  return new Date(Date.now() + INVITE_TTL_DAYS * 86400_000);
}
