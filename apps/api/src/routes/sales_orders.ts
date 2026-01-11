import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

const CreateSalesOrderBody = z.object({
  notes: z.string().max(5000).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
      })
    )
    .min(1),
});

function toQty(v: number | string): bigint {
  return typeof v === "number" ? BigInt(v) : BigInt(v);
}

function ipFromReq(req: any) {
  return ((req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip) as string;
}

export async function salesOrdersRoutes(app: FastifyInstance) {
  // CREATE (DRAFT)
  app.post("/sales-orders", async (req, reply) => {
    requireAuth(req);

    const body = CreateSalesOrderBody.parse(req.body);
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;

    // Validate itemIds belong to tenant
    const itemIds = Array.from(new Set(body.lines.map((l) => l.itemId)));
    const items = await prisma.item.findMany({
      where: { tenantId, id: { in: itemIds } },
      select: { id: true },
    });
    if (items.length !== itemIds.length) {
      return reply.code(400).send({ error: "bad_request", message: "one or more itemId are invalid for this tenant" });
    }

    const so = await prisma.$transaction(async (tx) => {
      const created = await tx.salesOrder.create({
        data: {
          tenantId,
          status: "DRAFT",
          notes: body.notes?.trim(),
          lines: {
            create: body.lines.map((l) => ({
              tenantId,
              itemId: l.itemId,
              qty: toQty(l.qty),
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "sales_order.create",
          entityType: "SalesOrder",
          entityId: created.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { linesCount: created.lines.length },
        },
      });

      return created;
    });

    return reply.code(201).send({
      id: so.id,
      status: so.status,
      notes: so.notes,
      createdAt: so.createdAt,
      lines: so.lines.map((l: any) => ({
        id: l.id,
        itemId: l.itemId,
        qty: l.qty.toString(),
      })),
    });
  });

  // READ
  app.get("/sales-orders/:id", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id as string;

    const so = await prisma.salesOrder.findFirst({
      where: { tenantId, id },
      include: { lines: true },
    });

    if (!so) return reply.code(404).send({ error: "not_found" });

    return reply.send({
      id: so.id,
      status: so.status,
      notes: so.notes,
      createdAt: so.createdAt,
      confirmedAt: so.confirmedAt,
      cancelledAt: so.cancelledAt,
      lines: so.lines.map((l: any) => ({
        id: l.id,
        itemId: l.itemId,
        qty: l.qty.toString(),
      })),
    });
  });

  // CONFIRM (RESERVE)
  app.post("/sales-orders/:id/confirm", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const id = (req.params as any).id as string;

    const allowNegRow = await prisma.tenantSetting.findFirst({
      where: { tenantId },
      select: { allowNegativeStock: true },
    });
    const allowNegativeStock = Boolean(allowNegRow?.allowNegativeStock);

    const result = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({
        where: { tenantId, id },
        include: { lines: true },
      });

      if (!so) return { kind: "not_found" as const };
      if (so.status === "CANCELLED") return { kind: "conflict" as const, message: "sales order is cancelled" };
      if (so.status === "CONFIRMED") return { kind: "conflict" as const, message: "sales order already confirmed" };

      const itemIds = Array.from(new Set(so.lines.map((l: any) => l.itemId)));
      const items = await tx.item.findMany({
        where: { tenantId, id: { in: itemIds } },
        select: { id: true, isStock: true },
      });
      const isStockById = new Map(items.map((i: any) => [i.id, Boolean(i.isStock)]));

      // Validate availability
      for (const ln of so.lines) {
        if (!isStockById.get(ln.itemId)) continue;

        const bal = await tx.inventoryBalance.findFirst({
          where: { tenantId, itemId: ln.itemId },
          select: { qtyOnHand: true, qtyReserved: true },
        });
        if (!bal) return { kind: "bad_request" as const, message: `missing inventory balance for item ${ln.itemId}` };

        const available = BigInt(bal.qtyOnHand) - BigInt(bal.qtyReserved);
        if (!allowNegativeStock && available < BigInt(ln.qty)) {
          return { kind: "bad_request" as const, message: `insufficient available stock for item ${ln.itemId}` };
        }
      }

      // Apply reservations
      for (const ln of so.lines) {
        if (!isStockById.get(ln.itemId)) continue;

        await tx.inventoryBalance.updateMany({
          where: { tenantId, itemId: ln.itemId },
          data: { qtyReserved: { increment: ln.qty } },
        });

        await tx.inventoryReservation.create({
          data: {
            tenantId,
            salesOrderId: so.id,
            salesOrderLineId: ln.id,
            itemId: ln.itemId,
            qty: ln.qty,
            status: "ACTIVE",
          },
        });
      }

      const updated = await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "sales_order.confirm",
          entityType: "SalesOrder",
          entityId: so.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: {},
        },
      });

      return { kind: "ok" as const, so: updated };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "conflict") return reply.code(409).send({ error: "conflict", message: result.message });
    if (result.kind === "bad_request") return reply.code(400).send({ error: "bad_request", message: result.message });

    return reply.send({ id: result.so.id, status: result.so.status, confirmedAt: result.so.confirmedAt });
  });

  // CANCEL (release reservations)
  app.post("/sales-orders/:id/cancel", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const id = (req.params as any).id as string;

    const result = await prisma.$transaction(async (tx) => {
      const so = await tx.salesOrder.findFirst({ where: { tenantId, id } });
      if (!so) return { kind: "not_found" as const };
      if (so.status === "CANCELLED") return { kind: "conflict" as const, message: "sales order already cancelled" };

      if (so.status === "DRAFT") {
        const updated = await tx.salesOrder.update({
          where: { id: so.id },
          data: { status: "CANCELLED", cancelledAt: new Date() },
        });

        await tx.auditEvent.create({
          data: {
            tenantId,
            actorUserId: userId,
            action: "sales_order.cancel",
            entityType: "SalesOrder",
            entityId: so.id,
            ip: ipFromReq(req),
            userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
            meta: {},
          },
        });

        return { kind: "ok" as const, so: updated };
      }

      const reservations = await tx.inventoryReservation.findMany({
        where: { tenantId, salesOrderId: so.id, status: "ACTIVE" },
        select: { itemId: true, qty: true },
      });

      const byItem = new Map<string, bigint>();
      for (const r of reservations) {
        byItem.set(r.itemId, (byItem.get(r.itemId) ?? 0n) + BigInt(r.qty));
      }

      for (const [itemId, sumQty] of byItem.entries()) {
        await tx.inventoryBalance.updateMany({
          where: { tenantId, itemId },
          data: { qtyReserved: { decrement: sumQty } },
        });
      }

      await tx.inventoryReservation.updateMany({
        where: { tenantId, salesOrderId: so.id, status: "ACTIVE" },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });

      const updated = await tx.salesOrder.update({
        where: { id: so.id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "sales_order.cancel",
          entityType: "SalesOrder",
          entityId: so.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: {},
        },
      });

      return { kind: "ok" as const, so: updated };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "conflict") return reply.code(409).send({ error: "conflict", message: result.message });

    return reply.send({ id: result.so.id, status: result.so.status, cancelledAt: result.so.cancelledAt });
  });
}
