/* eslint-disable */
/**
 * Email-OTP step in the sign-in flow. After password verification we mint
 * a 6-digit code, hash it (sha-256), and email the plaintext to the user.
 * They submit it on the login page to actually create a session.
 *
 *   user_id      — owner of the code; one user can have multiple active codes
 *                  (rapid retries, multi-tab) but only the most recent unused
 *                  one is honoured.
 *   code_hash    — sha-256 of the 6-digit code so a DB leak doesn't expose
 *                  the still-valid codes.
 *   expires_at   — 5 minutes after creation.
 *   used_at      — non-null once successfully consumed (one-shot codes).
 *   created_at   — for rate-limit windows ("only allow N codes per 5 min").
 *
 * Rows are tiny; we sweep them with a daily cron rather than per-request.
 */
exports.up = (pgm) => {
  pgm.sql(`
    create table email_otps (
      id uuid primary key default gen_random_uuid(),
      user_id uuid not null references users(id) on delete cascade,
      code_hash text not null,
      expires_at timestamptz not null,
      used_at timestamptz,
      created_at timestamptz not null default now()
    );
    create index email_otps_user_idx on email_otps (user_id, created_at desc);
    create index email_otps_expires_idx on email_otps (expires_at);
  `);
};

exports.down = (pgm) => {
  pgm.sql(`drop table if exists email_otps;`);
};
