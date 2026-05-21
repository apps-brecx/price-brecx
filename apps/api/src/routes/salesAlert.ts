import type { FastifyInstance } from "fastify";
import { salesAlertUpdateSchema, type SalesAlert } from "@fbm/shared";
import { sql, jsonb } from "../db.js";

const cols = sql`
  enabled, send_time as "sendTime", timezone, emails,
  threshold_drop_pct as "thresholdDropPct",
  threshold_zero_days as "thresholdZeroDays",
  threshold_low_days as "thresholdLowDays",
  last_sent_on as "lastSentOn", updated_at as "updatedAt"
`;

/**
 * Sales Alert settings — per-workspace schedule for the daily sales-alert
 * email digest. The digest itself is sent by SALES_ALERT_DIGEST_QUEUE.
 */
export default async function salesAlertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/sales-alert", async (req): Promise<SalesAlert> => {
    const [row] = await sql`
      select ${cols} from sales_alert_settings
      where workspace_id = ${req.user!.workspaceId}
    `;
    if (row) return row as SalesAlert;
    return {
      enabled: false,
      sendTime: "09:00",
      timezone: "America/New_York",
      emails: [],
      thresholdDropPct: 30,
      thresholdZeroDays: 14,
      thresholdLowDays: 14,
      lastSentOn: null,
      updatedAt: null,
    };
  });

  app.put("/sales-alert", async (req): Promise<SalesAlert> => {
    const body = salesAlertUpdateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    const [row] = await sql`
      insert into sales_alert_settings
        (workspace_id, enabled, send_time, timezone, emails,
         threshold_drop_pct, threshold_zero_days, threshold_low_days,
         last_sent_on)
      values (
        ${wsId},
        ${body.enabled ?? false},
        ${body.sendTime ?? "09:00"},
        ${body.timezone ?? "America/New_York"},
        ${jsonb(body.emails ?? [])},
        ${body.thresholdDropPct ?? 30},
        ${body.thresholdZeroDays ?? 14},
        ${body.thresholdLowDays ?? 14},
        null
      )
      on conflict (workspace_id) do update set
        enabled              = coalesce(${body.enabled ?? null}, sales_alert_settings.enabled),
        send_time            = coalesce(${body.sendTime ?? null}, sales_alert_settings.send_time),
        timezone             = coalesce(${body.timezone ?? null}, sales_alert_settings.timezone),
        emails               = ${body.emails ? jsonb(body.emails) : sql`sales_alert_settings.emails`},
        threshold_drop_pct   = coalesce(${body.thresholdDropPct ?? null}, sales_alert_settings.threshold_drop_pct),
        threshold_zero_days  = coalesce(${body.thresholdZeroDays ?? null}, sales_alert_settings.threshold_zero_days),
        threshold_low_days   = coalesce(${body.thresholdLowDays ?? null}, sales_alert_settings.threshold_low_days),
        last_sent_on         = null,
        updated_at           = now()
      returning ${cols}
    `;
    return row as SalesAlert;
  });
}
