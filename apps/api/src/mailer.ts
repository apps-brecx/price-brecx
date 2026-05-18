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
}): Promise<void> {
  const t = getTransporter();
  if (!t) {
    logger.warn({ to: opts.to, subject: opts.subject }, "SMTP not configured — email skipped");
    return;
  }
  await t.sendMail({
    from: env.SMTP_FROM ?? "Priceobo <no-reply@priceobo.com>",
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
}
