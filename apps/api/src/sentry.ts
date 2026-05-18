import * as Sentry from "@sentry/node";
import { env, isProd } from "./env.js";

let initialized = false;

export function initSentry(): void {
  if (!env.SENTRY_DSN || initialized) return;
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: isProd ? 0.1 : 1.0,
  });
  initialized = true;
}

export function captureError(err: unknown): void {
  if (initialized) Sentry.captureException(err);
}
