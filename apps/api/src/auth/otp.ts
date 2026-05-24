import { randomInt, createHash } from "node:crypto";
import { sql } from "../db.js";

const OTP_TTL_MINUTES = 5;
/** Rate limit: at most this many codes issued per user inside the rolling
 *  TTL window. Stops a malicious actor from blasting an inbox. */
const MAX_CODES_PER_WINDOW = 5;

export const OTP_EXPIRES_IN_MINUTES = OTP_TTL_MINUTES;

function hashCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

/** Cryptographically random 6-digit string, zero-padded. */
function generate6(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export interface IssueResult {
  /** Plaintext code to email — never persisted, only its hash is stored. */
  code: string;
  /** ISO timestamp the code stops being valid. */
  expiresAt: string;
}

/**
 * Mint a new sign-in OTP for the given user and persist its hash. Returns
 * the plaintext code so the caller (the sign-in route) can email it. Throws
 * a friendly RateLimitError when the user has burned through their quota
 * inside the current TTL window.
 */
export async function issueOtp(userId: string): Promise<IssueResult> {
  const [{ count }] = await sql<{ count: number }[]>`
    select count(*)::int as count
      from email_otps
     where user_id = ${userId}
       and created_at > now() - interval '${sql.unsafe(String(OTP_TTL_MINUTES))} minutes'
  `;
  if (count >= MAX_CODES_PER_WINDOW) {
    throw new RateLimitError(
      `Too many sign-in codes requested. Try again in ${OTP_TTL_MINUTES} minutes.`,
    );
  }
  const code = generate6();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + OTP_TTL_MINUTES * 60_000);
  await sql`
    insert into email_otps (user_id, code_hash, expires_at)
    values (${userId}, ${codeHash}, ${expiresAt})
  `;
  return { code, expiresAt: expiresAt.toISOString() };
}

/**
 * Verify a user-submitted code. Returns true on success and marks the row
 * consumed so the same code can't be replayed. Constant-time comparison via
 * hash equality — the plaintext is never read from the DB.
 */
export async function verifyOtp(
  userId: string,
  code: string,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const codeHash = hashCode(code);
  const rows = await sql<{ id: string }[]>`
    update email_otps
       set used_at = now()
     where user_id = ${userId}
       and code_hash = ${codeHash}
       and used_at is null
       and expires_at > now()
     returning id
  `;
  return rows.length > 0;
}

export class RateLimitError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "RateLimitError";
  }
}
