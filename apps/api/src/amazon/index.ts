import { env } from "../env.js";
import { logger } from "../logger.js";
import type { AmazonProvider } from "./types.js";
import { SpapiProvider } from "./spapi.js";
import { StubAmazonProvider } from "./stub.js";

let provider: AmazonProvider | null = null;

export function getAmazonProvider(): AmazonProvider {
  if (provider) return provider;

  const hasCreds =
    env.REFRESH_TOKEN &&
    env.LWA_APP_ID &&
    env.LWA_CLIENT_SECRET &&
    env.SELLER_ID &&
    env.MARKETPLACE_ID;

  if (hasCreds) {
    provider = new SpapiProvider({
      refreshToken: env.REFRESH_TOKEN!,
      lwaAppId: env.LWA_APP_ID!,
      lwaClientSecret: env.LWA_CLIENT_SECRET!,
      sellerId: env.SELLER_ID!,
      marketplaceId: env.MARKETPLACE_ID!,
      endpoint: env.SPAPI_ENDPOINT,
    });
    logger.info("Amazon SP-API: live provider active");
  } else {
    provider = new StubAmazonProvider();
    logger.warn("Amazon SP-API: credentials missing, using stub provider");
  }
  return provider;
}

export type { AmazonProvider } from "./types.js";
