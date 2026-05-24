import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SESSION_COOKIE } from "@fbm/shared";
import { resolveSession, touchSession, type SessionUser } from "./sessions.js";

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

  // Last-seen timestamps are stored sparsely — bumping on every request
  // would write-amplify the sessions table. Throttle to once per minute per
  // session by remembering the last time we touched each fingerprint.
  const lastTouched = new Map<string, number>();
  const TOUCH_THROTTLE_MS = 60_000;

  app.addHook("onRequest", async (req) => {
    const token = req.cookies?.[SESSION_COOKIE];
    req.user = await resolveSession(token);
    if (req.user && token) {
      const last = lastTouched.get(token) ?? 0;
      if (Date.now() - last > TOUCH_THROTTLE_MS) {
        lastTouched.set(token, Date.now());
        // Fire-and-forget so request latency isn't hostage to the update.
        void touchSession(token);
      }
    }
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
