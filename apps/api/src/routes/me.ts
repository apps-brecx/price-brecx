import type { FastifyInstance } from "fastify";

export default async function meRoutes(app: FastifyInstance) {
  app.get(
    "/me",
    { preHandler: app.requireAuth },
    async (req) => ({ user: req.user }),
  );
}
