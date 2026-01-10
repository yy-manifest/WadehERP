import type { FastifyRequest } from "fastify";
import { prisma } from "../db";
import { sha256Hex } from "./crypto";

export async function attachAuth(req: FastifyRequest) {
  const header = req.headers["authorization"];
  if (!header) return;

  const m = /^Bearer\s+(.+)$/.exec(header);
  if (!m) return;

  const token = m[1]?.trim();
  if (!token) return;

  const tokenHash = sha256Hex(token);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!session) return;
  if (session.revokedAt) return;
  if (new Date() > session.expiresAt) return;

  req.auth = {
    userId: session.userId,
    tenantId: session.tenantId,
    sessionId: session.id,
  };
}

export function requireAuth(req: FastifyRequest) {
  if (!req.auth) {
    const err: any = new Error("unauthorized");
    err.statusCode = 401;
    throw err;
  }
}
