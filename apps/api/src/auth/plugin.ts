import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "@fbm/shared";
import { resolveSession, type SessionUser } from "./sessions.js";

declare module "fastify" {
  interface FastifyRequest {
    user: SessionUser | null;
  }
  interface FastifyInstance {
    requireAuth: (
      req: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

export default fp(async (app) => {
  app.decorateRequest("user", null);

  app.addHook("onRequest", async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = await resolveSession(token);
  });

  app.decorate(
    "requireAuth",
    async (req: FastifyRequest, reply: FastifyReply) => {
      if (!req.user) {
        await reply.code(401).send({ error: "Unauthorized" });
      }
    },
  );
});
