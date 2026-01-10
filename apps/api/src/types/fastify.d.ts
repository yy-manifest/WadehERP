import "fastify";

declare module "fastify" {
  interface FastifyRequest {
    auth?: {
      userId: string;
      tenantId: string;
      sessionId: string;
    };
  }
}
