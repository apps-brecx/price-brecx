import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { requireWorkspace } from '../lib/auth';

const upsertSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  warehouseName: z.string(),
  onHand: z.number().int().nonnegative(),
  reserved: z.number().int().nonnegative().optional(),
  incoming: z.number().int().nonnegative().optional(),
});

const shipmentSchema = z.object({
  inventoryId: z.string(),
  shipmentNumber: z.string(),
  origin: z.string(),
  destination: z.string(),
  carrier: z.string(),
  quantity: z.number().int().positive(),
  status: z.enum(['PLACED', 'IN_TRANSIT', 'AT_CUSTOMS', 'DELIVERED', 'CANCELLED']),
  placedAt: z.string().datetime(),
  estimatedArrival: z.string().datetime().optional(),
});

export const inventoryRoutes: FastifyPluginAsync = async (app) => {
  app.addHook('preHandler', requireWorkspace);

  app.get('/', async (req) => {
    const products = await prisma.product.findMany({
      where: { workspaceId: req.workspaceId! },
      include: {
        inventory: { include: { shipments: { orderBy: { placedAt: 'desc' }, take: 10 } } },
        skus: { include: { listings: { include: { connection: true } } } },
      },
      orderBy: { name: 'asc' },
    });
    return products;
  });

  app.get('/:productId', async (req, reply) => {
    const { productId } = req.params as { productId: string };
    const product = await prisma.product.findFirst({
      where: { id: productId, workspaceId: req.workspaceId! },
      include: {
        inventory: { include: { shipments: { orderBy: { placedAt: 'desc' } } } },
        skus: { include: { listings: { include: { connection: true } } } },
      },
    });
    if (!product) return reply.code(404).send({ error: 'Not found' });
    return product;
  });

  app.post('/', async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const product = await prisma.product.findFirst({ where: { id: body.productId, workspaceId: req.workspaceId! } });
    if (!product) return reply.code(400).send({ error: 'Product not in workspace' });
    const existing = await prisma.inventory.findFirst({
      where: { productId: body.productId, warehouseId: body.warehouseId },
    });
    if (existing) {
      return prisma.inventory.update({
        where: { id: existing.id },
        data: {
          onHand: body.onHand,
          reserved: body.reserved ?? existing.reserved,
          incoming: body.incoming ?? existing.incoming,
          warehouseName: body.warehouseName,
          lastSyncAt: new Date(),
        },
      });
    }
    return prisma.inventory.create({
      data: {
        productId: body.productId,
        warehouseId: body.warehouseId,
        warehouseName: body.warehouseName,
        onHand: body.onHand,
        reserved: body.reserved ?? 0,
        incoming: body.incoming ?? 0,
      },
    });
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const inv = await prisma.inventory.findFirst({ where: { id, product: { workspaceId: req.workspaceId! } } });
    if (!inv) return reply.code(404).send({ error: 'Not found' });
    await prisma.inventory.delete({ where: { id } });
    return { ok: true };
  });

  app.get('/shipments/all', async (req) => {
    return prisma.shipment.findMany({
      where: { inventory: { product: { workspaceId: req.workspaceId! } } },
      include: { inventory: { include: { product: true } } },
      orderBy: { placedAt: 'desc' },
    });
  });

  app.post('/shipments', async (req, reply) => {
    const body = shipmentSchema.parse(req.body);
    const inv = await prisma.inventory.findFirst({
      where: { id: body.inventoryId, product: { workspaceId: req.workspaceId! } },
    });
    if (!inv) return reply.code(400).send({ error: 'Inventory not in workspace' });
    return prisma.shipment.create({
      data: {
        inventoryId: body.inventoryId,
        shipmentNumber: body.shipmentNumber,
        origin: body.origin,
        destination: body.destination,
        carrier: body.carrier,
        quantity: body.quantity,
        status: body.status,
        placedAt: new Date(body.placedAt),
        estimatedArrival: body.estimatedArrival ? new Date(body.estimatedArrival) : null,
      },
    });
  });

  app.patch('/shipments/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.shipment.findFirst({
      where: { id, inventory: { product: { workspaceId: req.workspaceId! } } },
    });
    if (!existing) return reply.code(404).send({ error: 'Not found' });
    const body = shipmentSchema.partial().parse(req.body);
    return prisma.shipment.update({
      where: { id },
      data: {
        ...body,
        placedAt: body.placedAt ? new Date(body.placedAt) : undefined,
        estimatedArrival: body.estimatedArrival ? new Date(body.estimatedArrival) : undefined,
      },
    });
  });
};
