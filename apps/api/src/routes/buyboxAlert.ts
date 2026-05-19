import type { FastifyInstance } from "fastify";
import { buyboxAlertUpdateSchema, type BuyboxAlert } from "@fbm/shared";
import { sql, jsonb } from "../db.js";

const cols = sql`
  enabled, send_time as "sendTime", timezone, emails,
  last_sent_on as "lastSentOn", updated_at as "updatedAt"
`;

/**
 * Buy Box Alert settings — the per-workspace schedule for the loss-digest
 * email. The digest itself is sent by the BUYBOX_ALERT_DIGEST_QUEUE cron.
 */
export default async function buyboxAlertRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.get("/buybox-alert", async (req): Promise<BuyboxAlert> => {
    const [row] = await sql`
      select ${cols} from buybox_alert_settings
      where workspace_id = ${req.user!.workspaceId}
    `;
    if (row) return row as BuyboxAlert;
    return {
      enabled: false,
      sendTime: "09:00",
      timezone: "America/New_York",
      emails: [],
      lastSentOn: null,
      updatedAt: null,
    };
  });

  app.put("/buybox-alert", async (req): Promise<BuyboxAlert> => {
    const body = buyboxAlertUpdateSchema.parse(req.body);
    const wsId = req.user!.workspaceId;

    // Changing the schedule/recipients clears the "sent today" guard so a
    // freshly-configured alert can still fire later the same day.
    const [row] = await sql`
      insert into buybox_alert_settings
        (workspace_id, enabled, send_time, timezone, emails, last_sent_on)
      values (
        ${wsId},
        ${body.enabled ?? false},
        ${body.sendTime ?? "09:00"},
        ${body.timezone ?? "America/New_York"},
        ${jsonb(body.emails ?? [])},
        null
      )
      on conflict (workspace_id) do update set
        enabled      = coalesce(${body.enabled ?? null}, buybox_alert_settings.enabled),
        send_time    = coalesce(${body.sendTime ?? null}, buybox_alert_settings.send_time),
        timezone     = coalesce(${body.timezone ?? null}, buybox_alert_settings.timezone),
        emails       = ${body.emails ? jsonb(body.emails) : sql`buybox_alert_settings.emails`},
        last_sent_on = null,
        updated_at   = now()
      returning ${cols}
    `;
    return row as BuyboxAlert;
  });
}
