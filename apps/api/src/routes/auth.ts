import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { randomToken, sha256Hex } from "../lib/crypto";
import { requireAuth } from "../lib/auth";
import { audit } from "../lib/audit";

const SignupBody = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  tenantName: z.string().min(2).optional(),
});

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/signup", async (req, reply) => {
    const body = SignupBody.parse(req.body);
    const email = body.email.trim().toLowerCase();
    const passwordHash = await bcrypt.hash(body.password, 10);

    const token = randomToken(32);
    const tokenHash = sha256Hex(token);
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30); // 30 days

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const existing = await tx.user.findUnique({ where: { email } });
      if (existing) {
        const err: any = new Error("email_already_exists");
        err.statusCode = 409;
        throw err;
      }

      const tenant = await tx.tenant.create({
        data: { name: body.tenantName?.trim() || "My Store" },
      });

      const user = await tx.user.create({
        data: { tenantId: tenant.id, email, passwordHash },
      });

      const session = await tx.session.create({
        data: { tenantId: tenant.id, userId: user.id, tokenHash, expiresAt },
      });

      await tx.auditEvent.create({
        data: {
          tenantId: tenant.id,
          actorUserId: user.id,
          action: "auth.signup",
          entityType: "User",
          entityId: user.id,
          ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { email },
        },
      });

      return { tenant, user, session };
    });

    return reply.code(201).send({
      tenantId: result.tenant.id,
      user: { id: result.user.id, email: result.user.email },
      session: { token, expiresAt: result.session.expiresAt.toISOString() },
    });
  });

  app.post("/auth/logout", async (req, reply) => {
    requireAuth(req);

    await prisma.session.updateMany({
      where: {
        id: req.auth!.sessionId,
        tenantId: req.auth!.tenantId,
        userId: req.auth!.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await audit({
      tenantId: req.auth!.tenantId,
      actorUserId: req.auth!.userId,
      action: "auth.logout",
      entityType: "Session",
      entityId: req.auth!.sessionId,
      req,
    });

    return reply.code(204).send();
  });

  app.get("/me", async (req) => {
    requireAuth(req);

    const user = await prisma.user.findFirst({
      where: { id: req.auth!.userId, tenantId: req.auth!.tenantId },
      select: { id: true, email: true, tenantId: true, createdAt: true },
    });

    if (!user) {
      const err: any = new Error("unauthorized");
      err.statusCode = 401;
      throw err;
    }

    return { user };
  });
}
