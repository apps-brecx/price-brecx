import type { FastifyInstance } from "fastify";
import { marketplaceCredentialUpsertSchema } from "@fbm/shared";
import { sql } from "../db.js";
import { getAmazonProvider } from "../amazon/index.js";

const cols = sql`
  id, channel, label, seller_id as "sellerId",
  marketplace_id as "marketplaceId", connected,
  created_at as "createdAt"
`;

export default async function marketplaceRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/marketplaces", async (req) => {
    const items = await sql`
      select ${cols} from marketplace_credentials
      where workspace_id = ${req.user!.workspaceId}
      order by created_at desc
    `;
    return { items, amazonMode: getAmazonProvider().mode };
  });

  app.put("/marketplaces", async (req, reply) => {
    const body = marketplaceCredentialUpsertSchema.parse(req.body);
    const connected = Boolean(
      body.refreshToken && body.lwaAppId && body.lwaClientSecret,
    );
    const [row] = await sql`
      insert into marketplace_credentials
        (workspace_id, channel, label, seller_id, marketplace_id,
         refresh_token, lwa_app_id, lwa_client_secret, connected)
      values (
        ${req.user!.workspaceId}, ${body.channel}, ${body.label},
        ${body.sellerId ?? null}, ${body.marketplaceId ?? null},
        ${body.refreshToken ?? null}, ${body.lwaAppId ?? null},
        ${body.lwaClientSecret ?? null}, ${connected}
      )
      on conflict (workspace_id, channel) do update set
        label = excluded.label,
        seller_id = coalesce(excluded.seller_id, marketplace_credentials.seller_id),
        marketplace_id = coalesce(excluded.marketplace_id, marketplace_credentials.marketplace_id),
        refresh_token = coalesce(excluded.refresh_token, marketplace_credentials.refresh_token),
        lwa_app_id = coalesce(excluded.lwa_app_id, marketplace_credentials.lwa_app_id),
        lwa_client_secret = coalesce(excluded.lwa_client_secret, marketplace_credentials.lwa_client_secret),
        connected = excluded.connected
      returning ${cols}
    `;
    return reply.code(200).send(row);
  });
}
