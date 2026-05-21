import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getAmazonProvider } from "../amazon/index.js";

const querySchema = z.object({
  type: z.enum(["sku", "asin"]).default("sku"),
  /** Optional override; defaults to last 30 days for Day, last 12 months for Month. */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

function toYMD(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Per-SKU/ASIN sales report — backs the "See Pricing & Sales Report" modal.
 * Proxies SP-API Sales `/orderMetrics` so the UI doesn't need credentials and
 * we can shape the response (intervalStart → date | month) for the chart.
 */
export default async function salesReportRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/sales-metrics/:granularity/:identifier", async (req, reply) => {
    const { granularity, identifier } = req.params as {
      granularity: string;
      identifier: string;
    };
    if (granularity !== "day" && granularity !== "month") {
      return reply
        .code(400)
        .send({ error: "granularity must be 'day' or 'month'" });
    }
    const q = querySchema.parse(req.query);

    // Default windows mirror the legacy app's defaults (30 days / 18 months).
    const now = new Date();
    let start = q.startDate;
    let end = q.endDate ?? toYMD(now);
    if (!start) {
      const s = new Date(now);
      if (granularity === "day") s.setDate(s.getDate() - 30);
      else s.setMonth(s.getMonth() - 17); // 18 months including current
      start = toYMD(s);
    }

    const amazon = getAmazonProvider();
    try {
      const metrics = await amazon.getOrderMetrics({
        identifier: identifier.trim(),
        identifierType: q.type,
        granularity: granularity === "day" ? "Day" : "Month",
        startDate: start,
        endDate: end,
      });
      return {
        identifier,
        identifierType: q.type,
        granularity,
        startDate: start,
        endDate: end,
        items: metrics,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ error: msg });
    }
  });
}
