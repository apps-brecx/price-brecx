import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  HOST: z.string().default("0.0.0.0"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),

  SESSION_SECRET: z.string().min(16, "SESSION_SECRET must be at least 16 chars"),
  COOKIE_SECURE: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  // Use "none" when the web app and API are on different sites (e.g. two
  // *.onrender.com subdomains). "none" requires Secure (https).
  COOKIE_SAMESITE: z.enum(["lax", "none", "strict"]).default("lax"),

  CORS_ORIGIN: z.string().default("http://localhost:5173"),

  // Public URL of the web app — used to build invite links in emails.
  // Falls back to the first CORS_ORIGIN entry when unset.
  APP_URL: z.string().optional(),

  // Optional integrations — features degrade gracefully when unset.
  SENTRY_DSN: z.string().optional(),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  R2_PUBLIC_BASE_URL: z.string().optional(),

  // Amazon SP-API (LWA) — kept for legacy/standalone use, but the canonical
  // source of multi-channel inventory is now NineYard (see below).
  REFRESH_TOKEN: z.string().optional(),
  LWA_APP_ID: z.string().optional(),
  LWA_CLIENT_SECRET: z.string().optional(),
  SELLER_ID: z.string().optional(),
  MARKETPLACE_ID: z.string().optional(),
  SPAPI_ENDPOINT: z.string().default("https://sellingpartnerapi-na.amazon.com"),

  // NineYard — the consolidated multi-channel inventory backend. Returns
  // per-(account × channel) SKU listings, master items, and stock. When all
  // four NY_* values are set the NineYard sync replaces the legacy direct
  // Amazon SP-API sync as the primary data source.
  NINEYARD_BASE: z.string().default("https://backyard.nineyard.com"),
  NY_EMAIL: z.string().optional(),
  NY_PASSWORD: z.string().optional(),
  NY_COMPANY_ID: z.coerce.number().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === "production";

/** Base URL of the web app, used for links inside outbound emails. */
export const appUrl = (
  env.APP_URL ?? env.CORS_ORIGIN.split(",")[0] ?? "http://localhost:5173"
).replace(/\/+$/, "");
