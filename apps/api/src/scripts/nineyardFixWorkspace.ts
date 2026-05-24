/**
 * One-off: move the NineYard-synced rows from the orphan "ak" workspace
 * (no users, just where the first sync landed because it was created first)
 * into the active "ds" workspace where all four users actually live.
 *
 *   pnpm tsx src/scripts/nineyardFixWorkspace.ts
 *
 * Safe to re-run: noop after the first successful pass.
 */
import "dotenv/config";
import { sql } from "../db.js";
import { logger } from "../logger.js";

async function main() {
  // Source = workspace with NY rows + zero users.
  const [src] = await sql<{ id: string; name: string }[]>`
    select w.id, w.name
      from workspaces w
     where (select count(*) from users u where u.workspace_id = w.id) = 0
       and exists (
         select 1 from nineyard_items i where i.workspace_id = w.id
       )
     order by w.created_at asc
     limit 1
  `;

  // Target = workspace that actually has users.
  const [dst] = await sql<{ id: string; name: string }[]>`
    select w.id, w.name
      from workspaces w
     where exists (select 1 from users u where u.workspace_id = w.id)
     order by w.created_at asc
     limit 1
  `;

  if (!src) {
    logger.info("No orphan NineYard workspace found — nothing to move.");
    await sql.end({ timeout: 5 });
    return;
  }
  if (!dst) {
    logger.error("No workspace with users found — cannot pick destination.");
    process.exit(1);
  }
  if (src.id === dst.id) {
    logger.info("Source and destination are the same — nothing to do.");
    await sql.end({ timeout: 5 });
    return;
  }

  logger.info({ src, dst }, "Re-pointing NineYard data");

  // The destination workspace already has 3,385 legacy Amazon-direct rows
  // with NULL account_sku_id. Drop those first — they'd conflict with the
  // post-cutover view and have no path to update going forward.
  const dropped = await sql`
    delete from skus
     where workspace_id = ${dst.id}
       and account_sku_id is null
     returning id
  `;
  logger.info({ count: dropped.length }, "Dropped legacy Amazon-direct rows in destination");

  // Re-point items. Unique on (workspace_id, nineyard_item_id) holds because
  // destination has zero NY items.
  const items = await sql`
    update nineyard_items
       set workspace_id = ${dst.id}, updated_at = now()
     where workspace_id = ${src.id}
     returning id
  `;
  logger.info({ count: items.length }, "Moved nineyard_items rows");

  // Re-point skus. Same — destination has no rows with account_sku_id set.
  const skusMoved = await sql`
    update skus
       set workspace_id = ${dst.id}, updated_at = now()
     where workspace_id = ${src.id}
     returning id
  `;
  logger.info({ count: skusMoved.length }, "Moved skus rows");

  // Drop the empty source workspace so future syncs can't land there again.
  await sql`delete from workspaces where id = ${src.id}`;
  logger.info({ id: src.id }, "Deleted orphan source workspace");

  logger.info("Done — reload the Pricing page.");
  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
