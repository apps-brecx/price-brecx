import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { createUploadUrl, storageEnabled } from "../storage.js";

const body = z.object({
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1).max(120),
});

export default async function uploadRoutes(app: FastifyInstance) {
  app.addHook("preHandler", app.requireAuth);

  app.post("/uploads/sign", async (req, reply) => {
    if (!storageEnabled()) {
      return reply.code(503).send({ error: "Object storage not configured" });
    }
    const { filename, contentType } = body.parse(req.body);
    const key = `${req.user!.workspaceId}/${randomUUID()}-${filename}`;
    const result = await createUploadUrl(key, contentType);
    if (!result) return reply.code(503).send({ error: "Unavailable" });
    return result;
  });
}
