import PgBoss from "pg-boss";
import { env, appUrl } from "./env.js";
import { logger } from "./logger.js";
import { sql, jsonb } from "./db.js";
import { getAmazonProvider } from "./amazon/index.js";
import { syncAmazonToSkus } from "./amazon/sync.js";
import { runLostBuyboxScan } from "./amazon/buyboxScan.js";
import {
  beginScan,
  endScan,
  ScanCancelledError,
} from "./amazon/scanControl.js";
import { recordActivity } from "./lib/activity.js";
import { sendMail } from "./mailer.js";
import {
  buyBoxLossEmailHtml,
  buyBoxLossEmailText,
} from "./lib/emailTemplates.js";
import { broadcast } from "./ws.js";
import type { LostBuyboxRow } from "@fbm/shared";

/** Local calendar date + HH:MM for a timezone, no external date lib. */
function localParts(tz: string): { date: string; hm: string } {
  const now = new Date();
  try {
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const hm = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(now);
    return { date, hm };
  } catch {
    return { date: now.toISOString().slice(0, 10), hm: "00:00" };
  }
}

export const APPLY_PRICE_QUEUE = "apply-price";
export const SYNC_AMAZON_QUEUE = "sync-amazon";
export const LOST_BUYBOX_SCAN_QUEUE = "lost-buybox-scan";
/** Hourly fan-out: enqueues a Lost Buy Box scan for every workspace. */
export const LOST_BUYBOX_CRON_QUEUE = "lost-buybox-cron";
/** Every 15 min: sends the Buy Box loss digest at each workspace's chosen time. */
export const BUYBOX_ALERT_DIGEST_QUEUE = "buybox-alert-digest";

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
      const ctl = beginScan(workspaceId);
      try {
        const ignored = await sql<{ asin: string }[]>`
          select asin from ignored_asins where workspace_id = ${workspaceId}
        `;
        const ignoredSet = new Set(
          ignored.map((r) => r.asin.toUpperCase()),
        );

        const result = await runLostBuyboxScan(
          ignoredSet,
          (p) => broadcast(workspaceId, { type: "lost_buybox_progress", ...p }),
          ctl,
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
          // Email is no longer sent here — it's a scheduled digest driven by
          // the workspace's Buy Box Alert settings (BUYBOX_ALERT_DIGEST_QUEUE).
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
        if (err instanceof ScanCancelledError) {
          logger.info({ workspaceId }, "lost-buybox-scan cancelled");
          await recordActivity({
            workspaceId,
            actor,
            action: "updated",
            entityType: "lost_buybox",
            entityId: null,
            summary: "Buy Box scan cancelled",
            meta: { cancelled: true },
          });
          broadcast(workspaceId, {
            type: "lost_buybox_synced",
            ok: true,
            cancelled: true,
          });
        } else {
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
      } finally {
        endScan(workspaceId, ctl);
      }
    },
  );

  // ---- Hourly auto-scan: fan out one scan per workspace ----
  await boss.createQueue(LOST_BUYBOX_CRON_QUEUE);
  await boss.work(LOST_BUYBOX_CRON_QUEUE, async () => {
    const wss = await sql<{ id: string }[]>`select id from workspaces`;
    for (const w of wss) {
      await enqueueLostBuyboxScan({ workspaceId: w.id, actor: "system" });
    }
    logger.info(
      { workspaces: wss.length },
      "lost-buybox hourly cron fanned out",
    );
  });
  await boss.schedule(LOST_BUYBOX_CRON_QUEUE, "0 * * * *");

  // ---- Buy Box loss digest: emailed at each workspace's chosen time ----
  await boss.createQueue(BUYBOX_ALERT_DIGEST_QUEUE);
  await boss.work(BUYBOX_ALERT_DIGEST_QUEUE, async () => {
    const settings = await sql<
      {
        workspaceId: string;
        sendTime: string;
        timezone: string;
        emails: string[];
        lastSentOn: string | null;
        rows: LostBuyboxRow[] | null;
        marketplaceId: string | null;
        updatedAt: Date | null;
      }[]
    >`
      select s.workspace_id as "workspaceId", s.send_time as "sendTime",
             s.timezone, s.emails, s.last_sent_on as "lastSentOn",
             r.rows, r.marketplace_id as "marketplaceId",
             r.updated_at as "updatedAt"
        from buybox_alert_settings s
        left join lost_buybox_runs r on r.workspace_id = s.workspace_id
       where s.enabled = true
    `;
    for (const s of settings) {
      const { date, hm } = localParts(s.timezone);
      if (s.lastSentOn === date) continue; // already handled today
      if (hm < s.sendTime) continue; // not yet the chosen time
      const rows = s.rows ?? [];
      const emails = s.emails ?? [];
      if (rows.length > 0 && emails.length > 0) {
        await sendMail({
          to: emails,
          subject: `[Buy Box] ${rows.length} ASIN${
            rows.length === 1 ? "" : "s"
          } lost the Buy Box`,
          html: buyBoxLossEmailHtml({
            rows,
            marketplaceId: s.marketplaceId ?? null,
            reportUrl: `${appUrl}/buybox`,
            scannedAt: s.updatedAt ? s.updatedAt.toISOString() : null,
          }),
          text: buyBoxLossEmailText({
            rows,
            marketplaceId: s.marketplaceId ?? null,
            reportUrl: `${appUrl}/buybox`,
          }),
        }).catch((err) =>
          logger.error({ err }, "Buy Box digest email failed"),
        );
      }
      // Mark handled for today even when there were no losses, so we don't
      // re-query every 15 min for the rest of the day.
      await sql`
        update buybox_alert_settings
           set last_sent_on = ${date}, updated_at = now()
         where workspace_id = ${s.workspaceId}
      `;
    }
  });
  await boss.schedule(BUYBOX_ALERT_DIGEST_QUEUE, "*/15 * * * *");

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
