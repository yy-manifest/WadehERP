import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

const UpdateTenantSettingsBody = z.object({
  allowNegativeStock: z.boolean(),
});

export async function settingsRoutes(app: FastifyInstance) {
  // Read tenant settings (defaults are created if missing)
  app.get("/settings/tenant", async (req) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;

    const setting = await prisma.tenantSetting.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId, allowNegativeStock: false },
      select: { allowNegativeStock: true, updatedAt: true },
    });

    return { setting };
  });

  // Update tenant settings
  app.put("/settings/tenant", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const body = UpdateTenantSettingsBody.parse(req.body);

    const setting = await prisma.$transaction(async (tx) => {
      const updated = await tx.tenantSetting.upsert({
        where: { tenantId },
        update: { allowNegativeStock: body.allowNegativeStock },
        create: { tenantId, allowNegativeStock: body.allowNegativeStock },
        select: { allowNegativeStock: true, updatedAt: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "tenantSetting.update",
          entityType: "TenantSetting",
          entityId: tenantId,
          ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { allowNegativeStock: body.allowNegativeStock },
        },
      });

      return updated;
    });

    return reply.code(200).send({ setting });
  });
}
