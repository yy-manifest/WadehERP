import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

const CreateItemBody = z.object({
  sku: z.string().min(1).max(64),
  nameEn: z.string().min(1).max(200),
  nameAr: z.string().max(200).optional(),
  isStock: z.boolean().optional().default(true),
});

export async function itemRoutes(app: FastifyInstance) {
  app.post("/items", async (req, reply) => {
    requireAuth(req);

    const body = CreateItemBody.parse(req.body);
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;

    const item = await prisma.$transaction(async (tx) => {
      const created = await tx.item.create({
        data: {
          tenantId,
          sku: body.sku.trim(),
          nameEn: body.nameEn.trim(),
          nameAr: body.nameAr?.trim(),
          isStock: body.isStock ?? true,
        },
        select: { id: true, tenantId: true, sku: true, nameEn: true, nameAr: true, isStock: true, createdAt: true },
      });

      // Create an inventory balance row for stock items (single-warehouse baseline)
      if (created.isStock) {
        await tx.inventoryBalance.create({
          data: {
            tenantId,
            itemId: created.id,
            qtyOnHand: 0n,
            avgCostMinor: 0n,
          },
        });
      }

      // Audit (append-only)
      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "item.create",
          entityType: "Item",
          entityId: created.id,
          ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { sku: created.sku },
        },
      });

      return created;
    });

    return reply.code(201).send({ item });
  });

  app.get("/items", async (req) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;

    const items = await prisma.item.findMany({
      where: { tenantId },
      orderBy: { createdAt: "desc" },
      select: { id: true, sku: true, nameEn: true, nameAr: true, isStock: true, createdAt: true },
      take: 100,
    });

    return { items };
  });
}
