import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import "dotenv/config";
import { ZodError } from "zod";

import { attachAuth } from "./lib/auth";
import { healthRoutes } from "./routes/health";
import { authRoutes } from "./routes/auth";

function getLoggerConfig() {
  // Tests: no logger to keep output clean and avoid transports
  if (process.env.NODE_ENV === "test") return false;

  // Dev/prod: plain logger
  return true;
}

export function buildApp() {
  const app = Fastify({
    logger: getLoggerConfig(),
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
    // Validation errors -> 400 with structured issues
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        issues: err.issues,
      });
    }

    // Known app errors
    const statusCode = err?.statusCode ?? 500;

    // Never leak internal stack traces/messages in 500s
    if (statusCode >= 500) {
      return reply.code(500).send({ error: "internal_error" });
    }

    return reply.code(statusCode).send({ error: err?.message ?? "error" });
  });

  app.register(healthRoutes);
  app.register(authRoutes);

  return app;
}
