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

const ListQuery = z.object({
  q: z.string().optional().transform((v) => (v?.trim() ? v.trim() : undefined)),
  page: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined) return 1;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return 1;
      return Math.max(1, Math.trunc(n));
    }),
  limit: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined) return 50;
      const n = typeof v === "number" ? v : Number(v);
      if (!Number.isFinite(n)) return 50;
      return Math.max(1, Math.min(100, Math.trunc(n)));
    }),
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

  // Enriched list: search + pagination + balance summary
  app.get("/items", async (req) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const { q, page, limit } = ListQuery.parse(req.query ?? {});
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (q) {
      where.OR = [
        { sku: { contains: q, mode: "insensitive" } },
        { nameEn: { contains: q, mode: "insensitive" } },
        { nameAr: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.item.count({ where }),
      prisma.item.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: {
          id: true,
          sku: true,
          nameEn: true,
          nameAr: true,
          isStock: true,
          createdAt: true,
          balance: {
            select: { qtyOnHand: true, avgCostMinor: true, updatedAt: true },
          },
        },
      }),
    ]);

    return {
      page,
      limit,
      total,
      items: items.map((it) => ({
        id: it.id,
        sku: it.sku,
        nameEn: it.nameEn,
        nameAr: it.nameAr,
        isStock: it.isStock,
        createdAt: it.createdAt,
        balance: it.balance
          ? {
              qtyOnHand: it.balance.qtyOnHand.toString(),
              avgCostMinor: it.balance.avgCostMinor.toString(),
              updatedAt: it.balance.updatedAt,
            }
          : null,
      })),
    };
  });
}
