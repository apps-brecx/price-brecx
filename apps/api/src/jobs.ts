import PgBoss from "pg-boss";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { sql } from "./db.js";
import { getAmazonProvider } from "./amazon/index.js";
import { recordActivity } from "./lib/activity.js";
import { broadcast } from "./ws.js";

export const APPLY_PRICE_QUEUE = "apply-price";

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

  logger.info("pg-boss started");
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
