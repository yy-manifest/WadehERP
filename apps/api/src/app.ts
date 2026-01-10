import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import "dotenv/config";

import { attachAuth } from "./lib/auth";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

export function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV === "production" ? undefined : { target: "pino-pretty" },
    },
  });

  app.register(helmet);
  app.register(cors, {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : true,
    credentials: false,
  });

  app.addHook("preHandler", async (req) => {
    await attachAuth(req);
  });

  app.setErrorHandler((err: any, _req, reply) => {
    const statusCode = err?.statusCode ?? 500;
    reply.code(statusCode).send({ error: err?.message ?? "internal_error" });
  });

  app.register(healthRoutes);
  app.register(authRoutes);

  return app;
}
