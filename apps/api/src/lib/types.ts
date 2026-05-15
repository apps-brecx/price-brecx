import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
    workspaceId?: string;
  }
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: string };
    user: { userId: string };
  }
}
