import nodemailer from "nodemailer";
import { env } from "./env.js";
import { logger } from "./logger.js";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (transporter) return transporter;
  if (!env.SMTP_HOST || !env.SMTP_PORT) return null;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  return transporter;
}

export async function sendMail(opts: {
  to: string | string[];
  subject: string;
  html: string;
  /** Plain-text fallback. Sending multipart materially improves deliverability. */
  text?: string;
}): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.warn(
      { to: opts.to, subject: opts.subject },
      "SMTP not configured — email skipped (set SMTP_HOST/SMTP_PORT in .env)",
    );
    return;
  }
  await t.sendMail({
    from: env.SMTP_FROM ?? "Priceobo <no-reply@priceobo.com>",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  });
}

/**
 * Boot-time SMTP connectivity check. Deliberately non-fatal: a missing or
 * misconfigured mail server must never stop the API from serving requests —
 * invites still work via the acceptUrl returned in the API response.
 */
export async function verifyMailer(): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.warn("SMTP not configured — invite emails will be skipped");
    return;
  }
  try {
    await t.verify();
    logger.info({ host: env.SMTP_HOST, port: env.SMTP_PORT }, "SMTP ready");
  } catch (err) {
    logger.error({ err }, "SMTP verification failed — emails will not send");
  }
}
