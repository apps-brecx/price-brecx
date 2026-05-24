/**
 * One-off NineYard sync runner — bypasses pg-boss so you can populate the
 * Pricing page without standing up the worker. Reads creds from .env, picks
 * the first workspace, and runs the full Items → Skus → Mappings pipeline
 * inline.
 *
 *   pnpm --filter @fbm/api tsx src/scripts/nineyardSyncOnce.ts
 *
 * Re-runs are idempotent (every row is upserted by accountSkuId / itemId).
 */
import "dotenv/config";
import { sql } from "../db.js";
import { syncNineyardToSkus, nineyardReady } from "../nineyard/index.js";
import { logger } from "../logger.js";

async function main() {
  if (!nineyardReady()) {
    logger.error(
      "NineYard creds missing. Need NY_EMAIL, NY_PASSWORD, NY_COMPANY_ID in apps/api/.env",
    );
    process.exit(1);
  }

  // Pick the first workspace that actually has users — picking by created_at
  // can land on an orphan workspace and write the entire dataset where
  // nobody can see it (see nineyardFixWorkspace.ts for the cleanup).
  const [ws] = await sql<{ id: string; name: string }[]>`
    select w.id, w.name
      from workspaces w
     where exists (select 1 from users u where u.workspace_id = w.id)
     order by w.created_at asc
     limit 1
  `;
  if (!ws) {
    logger.error("No workspaces with users found — sign up via the web app first.");
    process.exit(1);
  }

  logger.info({ workspaceId: ws.id, name: ws.name }, "Starting NineYard sync");
  const res = await syncNineyardToSkus(ws.id);
  logger.info({ ...res }, "NineYard sync complete");
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
