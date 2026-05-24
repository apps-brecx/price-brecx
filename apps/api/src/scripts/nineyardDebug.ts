/**
 * Diagnostic — prints per-workspace counts so we can spot a workspace
 * mismatch between the sync target and the logged-in user.
 */
import "dotenv/config";
import { sql } from "../db.js";

async function main() {
  const workspaces = await sql<
    { id: string; name: string; createdAt: string }[]
  >`
    select id, name, created_at as "createdAt"
      from workspaces
     order by created_at asc
  `;

  console.log("=== workspaces ===");
  for (const w of workspaces) {
    const [{ users }] = await sql<{ users: number }[]>`
      select count(*)::int as users from users where workspace_id = ${w.id}
    `;
    const [{ skus }] = await sql<{ skus: number }[]>`
      select count(*)::int as skus from skus where workspace_id = ${w.id}
    `;
    const [{ withAcct }] = await sql<{ withAcct: number }[]>`
      select count(*)::int as "withAcct"
        from skus
       where workspace_id = ${w.id}
         and account_sku_id is not null
    `;
    const [{ items }] = await sql<{ items: number }[]>`
      select count(*)::int as items
        from nineyard_items
       where workspace_id = ${w.id}
    `;
    const [{ mapped }] = await sql<{ mapped: number }[]>`
      select count(*)::int as mapped
        from skus
       where workspace_id = ${w.id}
         and nineyard_item_id is not null
    `;
    console.log(`\n  Workspace: "${w.name}"  (${w.id})`);
    console.log(`    users      : ${users}`);
    console.log(`    skus total : ${skus}`);
    console.log(`    skus w/NY  : ${withAcct}`);
    console.log(`    ny_items   : ${items}`);
    console.log(`    mapped     : ${mapped}`);
  }

  console.log("\n=== users (workspace_id → email) ===");
  const users = await sql<{ email: string; workspaceId: string }[]>`
    select email, workspace_id as "workspaceId" from users
     order by created_at asc
  `;
  for (const u of users) console.log(`  ${u.email}  →  ${u.workspaceId}`);

  await sql.end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
