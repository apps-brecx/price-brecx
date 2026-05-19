import PgBoss from "pg-boss";
import { env, appUrl } from "./env.js";
import { logger } from "./logger.js";
import { sql, jsonb } from "./db.js";
import { getAmazonProvider } from "./amazon/index.js";
import { syncAmazonToSkus } from "./amazon/sync.js";
import { runLostBuyboxScan } from "./amazon/buyboxScan.js";
import { recordActivity } from "./lib/activity.js";
import { sendMail } from "./mailer.js";
import {
  buyBoxLossEmailHtml,
  buyBoxLossEmailText,
} from "./lib/emailTemplates.js";
import { broadcast } from "./ws.js";

export const APPLY_PRICE_QUEUE = "apply-price";
export const SYNC_AMAZON_QUEUE = "sync-amazon";
export const LOST_BUYBOX_SCAN_QUEUE = "lost-buybox-scan";

export interface SyncAmazonJob {
  workspaceId: string;
  actor: string;
}

export interface LostBuyboxScanJob {
  workspaceId: string;
  actor: string;
}

export interface ApplyPriceJob {
  scheduleId: string;
  skuId: string;
  sku: string;
  price: number;
  revertTo?: number;
  isRevert?: boolean;
  workspaceId: string;
}

let boss: PgBoss | null = null;

export function getBoss(): PgBoss {
  if (!boss) throw new Error("pg-boss not started");
  return boss;
}

export async function startJobs(): Promise<void> {
  boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    ssl: env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    schema: "pgboss",
  });

  boss.on("error", (err) => logger.error({ err }, "pg-boss error"));
  await boss.start();
  await boss.createQueue(APPLY_PRICE_QUEUE);

  await boss.work<ApplyPriceJob>(
    APPLY_PRICE_QUEUE,
    async ([job]) => {
      const { scheduleId, skuId, sku, price, isRevert, workspaceId } = job.data;
      const amazon = getAmazonProvider();
      const result = await amazon.updatePrice(sku, price);

      await sql`
        update skus set price = ${price}, updated_at = now()
        where id = ${skuId}
      `;
      await sql`
        update price_schedules
        set status = ${isRevert ? "reverted" : "running"},
            current_price = ${price}
        where id = ${scheduleId}
      `;
      await recordActivity({
        workspaceId,
        actor: "system",
        action: isRevert ? "price_reverted" : "price_changed",
        entityType: "price_schedule",
        entityId: scheduleId,
        summary: `${isRevert ? "Reverted" : "Applied"} price $${price.toFixed(
          2,
        )} for ${sku} (${amazon.mode})`,
        meta: { ok: result.ok, mode: amazon.mode },
      });
      broadcast(workspaceId, {
        type: "price_applied",
        skuId,
        sku,
        price,
        isRevert: !!isRevert,
      });
      logger.info({ sku, price, ok: result.ok }, "apply-price job done");
    },
  );

  await boss.createQueue(SYNC_AMAZON_QUEUE);
  await boss.work<SyncAmazonJob>(SYNC_AMAZON_QUEUE, async ([job]) => {
    const { workspaceId, actor } = job.data;
    try {
      const res = await syncAmazonToSkus(workspaceId);
      await recordActivity({
        workspaceId,
        actor,
        action: "updated",
        entityType: "sku",
        entityId: null,
        summary: `Amazon sync — ${res.upserted} SKUs (${res.mode})`,
        meta: { upserted: res.upserted, mode: res.mode },
      });
      broadcast(workspaceId, {
        type: "skus_synced",
        ok: true,
        count: res.upserted,
        mode: res.mode,
      });
      logger.info(
        { workspaceId, upserted: res.upserted, mode: res.mode },
        "sync-amazon job done",
      );
    } catch (err) {
      // Surface the reason instead of failing silently — the user only ever
      // sees an empty table otherwise. Don't rethrow (avoids pg-boss retry
      // loops on auth errors); the failure is recorded + pushed to the UI.
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, workspaceId }, "sync-amazon job failed");
      await recordActivity({
        workspaceId,
        actor,
        action: "updated",
        entityType: "sku",
        entityId: null,
        summary: `Amazon sync failed — ${msg}`,
        meta: { error: msg },
      });
      broadcast(workspaceId, { type: "skus_synced", ok: false, error: msg });
    }
  });

  await boss.createQueue(LOST_BUYBOX_SCAN_QUEUE);
  await boss.work<LostBuyboxScanJob>(
    LOST_BUYBOX_SCAN_QUEUE,
    async ([job]) => {
      const { workspaceId, actor } = job.data;
      try {
        const ignored = await sql<{ asin: string }[]>`
          select asin from ignored_asins where workspace_id = ${workspaceId}
        `;
        const ignoredSet = new Set(
          ignored.map((r) => r.asin.toUpperCase()),
        );

        const result = await runLostBuyboxScan(ignoredSet, (p) =>
          broadcast(workspaceId, { type: "lost_buybox_progress", ...p }),
        );

        const marketplaceId = env.MARKETPLACE_ID ?? null;
        await sql`
          insert into lost_buybox_runs
            (workspace_id, marketplace_id, seller_id, inventory_count,
             summary, rows, errored_asins, updated_at)
          values (
            ${workspaceId}, ${marketplaceId}, ${env.SELLER_ID ?? null},
            ${result.inventoryCount}, ${jsonb(result.summary)},
            ${jsonb(result.rows)}, ${jsonb(result.erroredAsins)}, now()
          )
          on conflict (workspace_id) do update set
            marketplace_id  = excluded.marketplace_id,
            seller_id       = excluded.seller_id,
            inventory_count = excluded.inventory_count,
            summary         = excluded.summary,
            rows            = excluded.rows,
            errored_asins   = excluded.errored_asins,
            updated_at      = now()
        `;

        if (result.rows.length > 0) {
          await sql`
            insert into lost_buybox_losses ${sql(
              result.rows.map((r) => ({
                workspace_id: workspaceId,
                asin: r.asin,
                reason: r.reason,
                marketplace_id: marketplaceId,
                buybox_price: r.buyboxPrice,
                my_price: r.myPrice,
                buybox_seller_id: r.buyboxSellerId,
              })),
              "workspace_id",
              "asin",
              "reason",
              "marketplace_id",
              "buybox_price",
              "my_price",
              "buybox_seller_id",
            )}
          `;
          // Email the person who ran the scan (mirrors the source app, which
          // notified the user who triggered Analyze). No-op if SMTP is unset.
          await sendMail({
            to: actor,
            subject: `[Buy Box] ${result.rows.length} ASIN${
              result.rows.length === 1 ? "" : "s"
            } lost the Buy Box`,
            html: buyBoxLossEmailHtml({
              rows: result.rows,
              marketplaceId,
              reportUrl: `${appUrl}/buybox`,
            }),
            text: buyBoxLossEmailText({
              rows: result.rows,
              marketplaceId,
              reportUrl: `${appUrl}/buybox`,
            }),
          }).catch((err) =>
            logger.error({ err }, "Buy Box loss email failed"),
          );
        }

        const amazon = getAmazonProvider();
        await recordActivity({
          workspaceId,
          actor,
          action: "updated",
          entityType: "lost_buybox",
          entityId: null,
          summary: `Buy Box scan — ${result.rows.length} lost of ${result.summary.total} (${amazon.mode})`,
          meta: {
            lost: result.rows.length,
            total: result.summary.total,
            errors: result.erroredAsins.length,
            mode: amazon.mode,
          },
        });
        broadcast(workspaceId, {
          type: "lost_buybox_synced",
          ok: true,
          count: result.rows.length,
          mode: amazon.mode,
        });
        logger.info(
          { workspaceId, lost: result.rows.length },
          "lost-buybox-scan job done",
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, workspaceId }, "lost-buybox-scan job failed");
        await recordActivity({
          workspaceId,
          actor,
          action: "updated",
          entityType: "lost_buybox",
          entityId: null,
          summary: `Buy Box scan failed — ${msg}`,
          meta: { error: msg },
        });
        broadcast(workspaceId, {
          type: "lost_buybox_synced",
          ok: false,
          error: msg,
        });
      }
    },
  );

  logger.info("pg-boss started");
}

/** Enqueue an Amazon → DB sync (runs async; report polling can take minutes). */
export async function enqueueAmazonSync(data: SyncAmazonJob): Promise<void> {
  await getBoss().send(SYNC_AMAZON_QUEUE, data);
}

/** Enqueue a Lost Buy Box scan (report + competitiveSummary on every ASIN). */
export async function enqueueLostBuyboxScan(
  data: LostBuyboxScanJob,
): Promise<void> {
  await getBoss().send(LOST_BUYBOX_SCAN_QUEUE, data);
}

export async function scheduleApplyPrice(
  data: ApplyPriceJob,
  startAfter: Date,
): Promise<void> {
  await getBoss().send(APPLY_PRICE_QUEUE, data, { startAfter });
}

export async function stopJobs(): Promise<void> {
  await boss?.stop({ graceful: true });
}
