import PgBoss from "pg-boss";
import { env, appUrl } from "./env.js";
import { logger } from "./logger.js";
import { sql, jsonb } from "./db.js";
import { getAmazonProvider } from "./amazon/index.js";
import {
  syncAmazonToSkus,
  syncListings,
  syncImages,
  syncFbaStock,
  syncSales,
  type StageResult,
} from "./amazon/sync.js";
import { runLostBuyboxScan } from "./amazon/buyboxScan.js";
import { syncNineyardToSkus, nineyardReady } from "./nineyard/index.js";
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
  salesAlertEmailHtml,
  salesAlertEmailText,
} from "./lib/emailTemplates.js";
import { evaluateSalesAlerts } from "./amazon/salesAlertEval.js";
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
/** Every minute: fires weekly/monthly schedule slots whose local time has come. */
export const SCHEDULE_TICK_QUEUE = "schedule-tick";
export const SYNC_AMAZON_QUEUE = "sync-amazon";
/** Consolidated NineYard sync — replaces the per-stage Amazon SP-API pipeline
 *  when NineYard credentials are configured (NY_EMAIL / NY_PASSWORD / NY_COMPANY_ID). */
export const SYNC_NINEYARD_QUEUE = "sync-nineyard";
/** Cron fan-out: every 2 hours, enqueues a NineYard sync job for every
 *  workspace. Matches the reference app's reported 2-3hr sync cadence. */
export const SYNC_NINEYARD_CRON_QUEUE = "sync-nineyard-cron";
export const LOST_BUYBOX_SCAN_QUEUE = "lost-buybox-scan";
/** Hourly fan-out: enqueues a Lost Buy Box scan for every workspace. */
export const LOST_BUYBOX_CRON_QUEUE = "lost-buybox-cron";
/** Every 15 min: sends the Buy Box loss digest at each workspace's chosen time. */
export const BUYBOX_ALERT_DIGEST_QUEUE = "buybox-alert-digest";
/** Every 15 min: evaluates sales-alert triggers + sends digest at chosen time. */
export const SALES_ALERT_DIGEST_QUEUE = "sales-alert-digest";

/* ----- Legacy-style 4-stage daily SKUs sync (Asia/Dhaka timings) ----- */
export const LISTINGS_SYNC_QUEUE = "listings-sync";          // per-workspace stage worker
export const IMAGE_SYNC_QUEUE = "image-sync";
export const FBA_SYNC_QUEUE = "fba-sync";
export const SALES_SYNC_QUEUE = "sales-sync";
/** Cron fan-outs (no payload): 8:00 / 8:30 / 11:00 / 11:30 Asia/Dhaka. */
export const LISTINGS_SYNC_CRON_QUEUE = "listings-sync-cron";
export const IMAGE_SYNC_CRON_QUEUE = "image-sync-cron";
export const FBA_SYNC_CRON_QUEUE = "fba-sync-cron";
export const SALES_SYNC_CRON_QUEUE = "sales-sync-cron";

export interface SyncAmazonJob {
  workspaceId: string;
  actor: string;
}

export interface LostBuyboxScanJob {
  workspaceId: string;
  actor: string;
}

export interface SkuStageJob {
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

/** Bumped on every behaviour change so we can spot stale processes in logs. */
const JOBS_VERSION = "v3-staged-sync-banners-2026-05-20";

export async function startJobs(): Promise<void> {
  logger.info(`🔧 jobs.ts loaded — ${JOBS_VERSION}`);
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
      const res = await syncAmazonToSkus(workspaceId, async (o) => {
        // Per-stage broadcast + activity so failures aren't silent.
        if (o.ok) {
          await recordActivity({
            workspaceId,
            actor,
            action: "updated",
            entityType: "sku",
            entityId: null,
            summary: `${o.stage} sync — ${o.affected} rows (${o.mode})`,
            meta: { stage: o.stage, affected: o.affected, mode: o.mode },
          });
          broadcast(workspaceId, {
            type: "skus_synced",
            ok: true,
            stage: o.stage,
            count: o.affected,
            mode: o.mode,
          });
        } else {
          await recordActivity({
            workspaceId,
            actor,
            action: "updated",
            entityType: "sku",
            entityId: null,
            summary: `${o.stage} sync failed — ${o.error}`,
            meta: { stage: o.stage, error: o.error },
          });
          broadcast(workspaceId, {
            type: "skus_synced",
            ok: false,
            stage: o.stage,
            error: o.error,
          });
        }
      });
      await recordActivity({
        workspaceId,
        actor,
        action: "updated",
        entityType: "sku",
        entityId: null,
        summary: `Amazon sync done — ${res.upserted} SKUs (${res.mode})`,
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

  /* ---------------------- NineYard sync worker ---------------------- */
  // One-call pipeline: master items → marketplace SKUs → mappings. Replaces
  // the 4-stage Amazon flow when NineYard credentials are present.
  await boss.createQueue(SYNC_NINEYARD_QUEUE);
  await boss.work<SyncAmazonJob>(SYNC_NINEYARD_QUEUE, async ([job]) => {
    const { workspaceId, actor } = job.data;
    try {
      const res = await syncNineyardToSkus(workspaceId);
      await recordActivity({
        workspaceId,
        actor,
        action: "updated",
        entityType: "sku",
        entityId: null,
        summary: `NineYard sync — ${res.skus} SKUs, ${res.items} items, ${res.mapped} mapped (${res.mode})`,
        meta: { ...res },
      });
      broadcast(workspaceId, {
        type: "skus_synced",
        ok: true,
        count: res.skus,
        mode: res.mode === "live" ? "live" : "stub",
      });
      logger.info({ workspaceId, ...res }, "sync-nineyard job done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, workspaceId }, "sync-nineyard job failed");
      await recordActivity({
        workspaceId,
        actor,
        action: "updated",
        entityType: "sku",
        entityId: null,
        summary: `NineYard sync failed — ${msg}`,
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

        // Enrich rows with image_url from the skus table — the merchant
        // listings report often returns blank image-url; our skus table is
        // backfilled via the Listings Items API (image-sync stage).
        if (result.rows.length > 0) {
          const asins = [...new Set(result.rows.map((r) => r.asin))];
          const imgRows = await sql<
            { asin: string; image_url: string | null }[]
          >`
            select asin, image_url from skus
            where workspace_id = ${workspaceId}
              and asin = any(${asins})
              and image_url is not null
          `;
          const imgByAsin = new Map(
            imgRows.map((r) => [r.asin, r.image_url] as const),
          );
          for (const row of result.rows) {
            if (!row.imageUrl) {
              row.imageUrl = imgByAsin.get(row.asin) ?? null;
            }
          }
        }

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
          // Immediate email to the person who ran the scan (manual click).
          // Hourly cron uses actor="system" → skipped here; daily digest
          // (BUYBOX_ALERT_DIGEST_QUEUE) covers scheduled recipients.
          if (actor.includes("@")) {
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

  // -------------- NineYard 2-hourly auto-sync cron --------------
  // Fans out a NineYard inventory sync to every workspace. UTC "0 */2 * * *"
  // fires at 00:00, 02:00, 04:00 … — matches the reference app's reported
  // 2-3hr cadence. Only fires when NineYard creds are configured (otherwise
  // the worker no-ops via `nineyardReady()`).
  await boss.createQueue(SYNC_NINEYARD_CRON_QUEUE);
  await boss.work(SYNC_NINEYARD_CRON_QUEUE, async () => {
    if (!nineyardReady()) {
      logger.info("NineYard cron tick — creds missing, skipping fan-out");
      return;
    }
    const wss = await sql<{ id: string }[]>`select id from workspaces`;
    for (const w of wss) {
      await getBoss().send(SYNC_NINEYARD_QUEUE, {
        workspaceId: w.id,
        actor: "system",
      });
    }
    logger.info(
      { workspaces: wss.length },
      "nineyard 2-hourly cron fanned out",
    );
  });
  await boss.schedule(SYNC_NINEYARD_CRON_QUEUE, "0 */2 * * *");

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

  // ---- Schedule tick: applies/reverts weekly + monthly slots when their
  //      local time arrives. Single-shot schedules are handled by direct
  //      pg-boss `startAfter` and don't need this tick.
  await boss.createQueue(SCHEDULE_TICK_QUEUE);
  await boss.work(SCHEDULE_TICK_QUEUE, async () => {
    interface SchedRow {
      id: string;
      skuId: string;
      sku: string;
      type: "single" | "weekly" | "monthly";
      timezone: string;
      timeSlots: Array<{
        day: number;
        startTime: string;
        endTime: string;
        price: number;
        revertPrice?: number;
      }>;
      workspaceId: string;
    }
    const rows = await sql<SchedRow[]>`
      select ps.id, ps.sku_id as "skuId", s.sku, ps.type, ps.timezone,
             ps.time_slots as "timeSlots", ps.workspace_id as "workspaceId"
        from price_schedules ps
        join skus s on s.id = ps.sku_id
       where ps.status in ('scheduled','running')
         and ps.type in ('weekly','monthly')
    `;
    for (const r of rows) {
      const { date: localDate, hm } = localParts(r.timezone);
      const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay(); // 0..6
      const dayOfMonth = Number(localDate.slice(8, 10));
      for (const slot of r.timeSlots) {
        const matchesDay =
          r.type === "weekly"
            ? slot.day === weekday
            : slot.day === dayOfMonth;
        if (!matchesDay) continue;
        if (slot.startTime === hm) {
          await getBoss().send(APPLY_PRICE_QUEUE, {
            scheduleId: r.id,
            skuId: r.skuId,
            sku: r.sku,
            price: slot.price,
            workspaceId: r.workspaceId,
          } satisfies ApplyPriceJob);
        }
        if (slot.endTime === hm && slot.revertPrice != null) {
          await getBoss().send(APPLY_PRICE_QUEUE, {
            scheduleId: r.id,
            skuId: r.skuId,
            sku: r.sku,
            price: slot.revertPrice,
            isRevert: true,
            workspaceId: r.workspaceId,
          } satisfies ApplyPriceJob);
        }
      }
    }
  });
  await boss.schedule(SCHEDULE_TICK_QUEUE, "* * * * *");

  // ---- Sales-alert digest: evaluate triggers + email at chosen time ----
  await boss.createQueue(SALES_ALERT_DIGEST_QUEUE);
  await boss.work(SALES_ALERT_DIGEST_QUEUE, async () => {
    const settings = await sql<
      {
        workspaceId: string;
        sendTime: string;
        timezone: string;
        emails: string[];
        thresholdDropPct: number;
        thresholdZeroDays: number;
        thresholdLowDays: number;
        lastSentOn: string | null;
      }[]
    >`
      select workspace_id as "workspaceId", send_time as "sendTime",
             timezone, emails,
             threshold_drop_pct as "thresholdDropPct",
             threshold_zero_days as "thresholdZeroDays",
             threshold_low_days as "thresholdLowDays",
             last_sent_on as "lastSentOn"
        from sales_alert_settings
       where enabled = true
    `;
    for (const s of settings) {
      const { date, hm } = localParts(s.timezone);
      if (s.lastSentOn === date) continue;
      if (hm < s.sendTime) continue;

      try {
        const items = await evaluateSalesAlerts(s.workspaceId, {
          thresholdDropPct: s.thresholdDropPct,
          thresholdZeroDays: s.thresholdZeroDays,
          thresholdLowDays: s.thresholdLowDays,
        });

        // De-dupe today's alerts: only insert (workspace, sku_id, reason) we
        // haven't already created for the same kind today, so re-runs in the
        // same day don't pile rows up if the cron retries.
        if (items.length > 0) {
          const rows = items.map((a) => ({
            workspace_id: s.workspaceId,
            kind: "sales",
            sku_id: a.skuId,
            title: a.title_full,
            message: a.message,
            severity: a.severity,
          }));
          await sql`
            insert into alerts ${sql(
              rows,
              "workspace_id",
              "kind",
              "sku_id",
              "title",
              "message",
              "severity",
            )}
          `;
        }

        const emails = s.emails ?? [];
        if (items.length > 0 && emails.length > 0) {
          const reportUrl = `${appUrl}/sales`;
          await sendMail({
            to: emails,
            subject: `[Sales] ${items.length} alert${
              items.length === 1 ? "" : "s"
            } for your SKUs`,
            html: salesAlertEmailHtml({
              rows: items.map((a) => ({
                sku: a.sku,
                asin: a.asin,
                reason: a.reason,
                stock: a.stock,
                sales7d: a.sales7d,
                sales30d: a.sales30d,
                daysOfSupply: a.daysOfSupply,
                message: a.message,
              })),
              reportUrl,
              scannedAt: new Date().toISOString(),
            }),
            text: salesAlertEmailText({
              rows: items.map((a) => ({
                sku: a.sku,
                asin: a.asin,
                reason: a.reason,
                stock: a.stock,
                sales7d: a.sales7d,
                sales30d: a.sales30d,
                daysOfSupply: a.daysOfSupply,
                message: a.message,
              })),
              reportUrl,
            }),
          }).catch((err) =>
            logger.error({ err }, "Sales-alert digest email failed"),
          );
        }

        if (items.length > 0) {
          broadcast(s.workspaceId, {
            type: "sales_alerts_evaluated",
            count: items.length,
          });
        }

        await sql`
          update sales_alert_settings
             set last_sent_on = ${date}, updated_at = now()
           where workspace_id = ${s.workspaceId}
        `;
      } catch (err) {
        logger.error(
          { err, workspaceId: s.workspaceId },
          "sales-alert evaluation failed",
        );
      }
    }
  });
  await boss.schedule(SALES_ALERT_DIGEST_QUEUE, "*/15 * * * *");

  // ---- Legacy-style 4-stage daily SKUs sync (Asia/Dhaka) ----
  //   8:00  listings (merchant listings report → title/asin/price/qty)
  //   8:30  images   (no-op for now — report already carries image-url)
  //  11:00  FBA      (FBA inventory → fulfillable + pending + fn_sku)
  //  11:30  sales    (all-orders report → 1D/7D/15D/30D salesMetrics)
  const stages: Array<{
    queue: string;
    cronQueue: string;
    cron: string;
    label: string;
    fn: (wsId: string) => Promise<StageResult>;
  }> = [
    { queue: LISTINGS_SYNC_QUEUE, cronQueue: LISTINGS_SYNC_CRON_QUEUE,
      cron: "0 8 * * *",  label: "Listings sync", fn: syncListings },
    { queue: IMAGE_SYNC_QUEUE,    cronQueue: IMAGE_SYNC_CRON_QUEUE,
      cron: "30 8 * * *", label: "Image sync",    fn: syncImages },
    { queue: FBA_SYNC_QUEUE,      cronQueue: FBA_SYNC_CRON_QUEUE,
      cron: "0 11 * * *", label: "FBA stock sync", fn: syncFbaStock },
    { queue: SALES_SYNC_QUEUE,    cronQueue: SALES_SYNC_CRON_QUEUE,
      cron: "30 11 * * *", label: "Sales sync",   fn: syncSales },
  ];

  for (const s of stages) {
    await boss.createQueue(s.queue);
    await boss.work<SkuStageJob>(s.queue, async ([job]) => {
      const { workspaceId, actor } = job.data;
      try {
        const result = await s.fn(workspaceId);
        await recordActivity({
          workspaceId,
          actor,
          action: "updated",
          entityType: "sku",
          entityId: null,
          summary: `${s.label} — ${result.affected} rows (${result.mode})`,
          meta: {
            stage: result.stage,
            affected: result.affected,
            mode: result.mode,
          },
        });
        broadcast(workspaceId, {
          type: "skus_synced",
          ok: true,
          stage: result.stage,
          count: result.affected,
          mode: result.mode,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({ err, workspaceId }, `${s.label} job failed`);
        await recordActivity({
          workspaceId,
          actor,
          action: "updated",
          entityType: "sku",
          entityId: null,
          summary: `${s.label} failed — ${msg}`,
          meta: { error: msg },
        });
        broadcast(workspaceId, {
          type: "skus_synced",
          ok: false,
          error: msg,
        });
      }
    });

    // Per-cron fan-out: enqueue one stage job per workspace.
    await boss.createQueue(s.cronQueue);
    await boss.work(s.cronQueue, async () => {
      const wss = await sql<{ id: string }[]>`select id from workspaces`;
      for (const w of wss) {
        await getBoss().send(s.queue, {
          workspaceId: w.id,
          actor: "system",
        } satisfies SkuStageJob);
      }
      logger.info(
        { stage: s.label, workspaces: wss.length },
        "SKU stage cron fanned out",
      );
    });
    await boss.schedule(s.cronQueue, s.cron, undefined, { tz: "Asia/Dhaka" });
  }

  logger.info("pg-boss started");
}

/** Enqueue an Amazon → DB sync (runs async; report polling can take minutes). */
export async function enqueueAmazonSync(data: SyncAmazonJob): Promise<void> {
  await getBoss().send(SYNC_AMAZON_QUEUE, data);
}

/** Enqueue a NineYard → DB sync. Falls back to the legacy Amazon SP-API path
 *  via `enqueueAmazonSync` when NineYard creds aren't configured. */
export async function enqueueInventorySync(data: SyncAmazonJob): Promise<void> {
  if (nineyardReady()) {
    await getBoss().send(SYNC_NINEYARD_QUEUE, data);
  } else {
    await getBoss().send(SYNC_AMAZON_QUEUE, data);
  }
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
