import { env } from "../env.js";
import { logger } from "../logger.js";
import type { AmazonProvider } from "./types.js";
import { SpapiProvider } from "./spapi.js";
import { StubAmazonProvider } from "./stub.js";

let provider: AmazonProvider | null = null;

export function getAmazonProvider(): AmazonProvider {
  if (provider) return provider;

  const hasCreds =
    env.SPAPI_REFRESH_TOKEN &&
    env.SPAPI_LWA_APP_ID &&
    env.SPAPI_LWA_CLIENT_SECRET &&
    env.SPAPI_SELLER_ID &&
    env.SPAPI_MARKETPLACE_ID;

  if (hasCreds) {
    provider = new SpapiProvider({
      refreshToken: env.SPAPI_REFRESH_TOKEN!,
      lwaAppId: env.SPAPI_LWA_APP_ID!,
      lwaClientSecret: env.SPAPI_LWA_CLIENT_SECRET!,
      sellerId: env.SPAPI_SELLER_ID!,
      marketplaceId: env.SPAPI_MARKETPLACE_ID!,
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
