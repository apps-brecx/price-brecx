/**
 * Bootstrap seed: creates one workspace + owner user from env vars.
 * Intentionally seeds NO product/SKU data — real data comes from the app
 * (imports, marketplace sync). Run:
 *   SEED_EMAIL=you@example.com SEED_PASSWORD=changeme pnpm db:seed
 */
import { sql } from "../db.js";
import { hashPassword } from "../auth/sessions.js";

const email = process.env.SEED_EMAIL;
const password = process.env.SEED_PASSWORD;
const name = process.env.SEED_NAME ?? "Owner";
const workspaceName = process.env.SEED_WORKSPACE ?? "My Workspace";

async function run() {
  if (!email || !password) {
    console.error("SEED_EMAIL and SEED_PASSWORD are required");
    process.exit(1);
  }
  const existing = await sql`select 1 from users where email = ${email}`;
  if (existing.length) {
    console.log(`User ${email} already exists — nothing to do.`);
    await sql.end();
    return;
  }
  const [ws] = await sql<{ id: string }[]>`
    insert into workspaces (name) values (${workspaceName}) returning id
  `;
  const hash = await hashPassword(password);
  await sql`
    insert into users (workspace_id, email, name, password_hash, role)
    values (${ws.id}, ${email}, ${name}, ${hash}, 'owner')
  `;
  console.log(`Seeded workspace "${workspaceName}" + owner ${email}`);
  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
