// Seeds the first owner user + workspace. Does NOT insert any sample products,
// SKUs, schedules, alerts, etc. The app starts with empty data.
//
// Usage:
//   SEED_EMAIL=you@example.com SEED_PASSWORD=changeme npm run db:seed
//
// If the user already exists this script is a no-op.

import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_EMAIL ?? 'admin@priceobo.local';
  const password = process.env.SEED_PASSWORD ?? 'priceobo-admin';
  const name = process.env.SEED_NAME ?? 'Admin';
  const workspaceName = process.env.SEED_WORKSPACE ?? 'My Workspace';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`User ${email} already exists. Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, name, passwordHash } });
  const slug = workspaceName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const workspace = await prisma.workspace.create({
    data: { name: workspaceName, slug: slug || 'workspace', ownerId: user.id },
  });
  await prisma.membership.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: 'OWNER',
      permissions: ['admin', 'write', 'billing'],
    },
  });

  console.log(`Seeded owner ${email} into workspace "${workspaceName}".`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
