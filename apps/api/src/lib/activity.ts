import { sql, jsonb } from "../db.js";
import type { ActivityAction } from "@fbm/shared";

export async function recordActivity(input: {
  workspaceId: string;
  actor: string;
  action: ActivityAction;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  await sql`
    insert into activity_log
      (workspace_id, actor, action, entity_type, entity_id, summary, meta)
    values (
      ${input.workspaceId},
      ${input.actor},
      ${input.action},
      ${input.entityType},
      ${input.entityId ?? null},
      ${input.summary},
      ${jsonb(input.meta ?? {})}
    )
  `;
}
