import type { FastifyRequest } from "fastify";
import { prisma } from "../db";

type AuditInput = {
  tenantId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  meta?: any;
  req?: FastifyRequest;
};

export async function audit(input: AuditInput) {
  const ip =
    (input.req?.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    input.req?.ip ??
    null;

  const userAgent = (input.req?.headers["user-agent"] as string | undefined) ?? null;

  await prisma.auditEvent.create({
    data: {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      ip,
      userAgent,
      meta: input.meta ?? undefined,
    },
  });
}
