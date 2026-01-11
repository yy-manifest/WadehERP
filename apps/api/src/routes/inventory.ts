import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

function toBigInt(n: unknown) {
  if (typeof n === "bigint") return n;
  if (typeof n === "number") return BigInt(Math.trunc(n));
  if (typeof n === "string" && n.trim() !== "") return BigInt(n);
  throw new Error("invalid_number");
}

const AdjustBody = z.object({
  itemId: z.string().min(1),
  qtyDelta: z.union([z.number(), z.string()]), // allow "5" or 5
  unitCostMinor: z.union([z.number(), z.string()]).optional(), // required if qtyDelta > 0
  note: z.string().max(500).optional(),
});

const ItemIdParams = z.object({
  itemId: z.string().min(1),
});

const MovementsQuery = z.object({
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

export async function inventoryRoutes(app: FastifyInstance) {
  // Read: balance
  app.get("/items/:itemId/balance", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const { itemId } = ItemIdParams.parse(req.params);

    const item = await prisma.item.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true, isStock: true },
    });

    if (!item) return reply.code(404).send({ error: "item_not_found" });
    if (!item.isStock) return reply.code(400).send({ error: "item_is_not_stock_tracked" });

    const bal = await prisma.inventoryBalance.findFirst({
      where: { tenantId, itemId },
      select: { qtyOnHand: true, avgCostMinor: true, updatedAt: true },
    });

    if (!bal) return reply.code(500).send({ error: "inventory_balance_missing" });

    return reply.code(200).send({
      balance: {
        itemId,
        qtyOnHand: bal.qtyOnHand.toString(),
        avgCostMinor: bal.avgCostMinor.toString(),
        updatedAt: bal.updatedAt,
      },
    });
  });

  // Read: movements (newest first)
  app.get("/items/:itemId/movements", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const { itemId } = ItemIdParams.parse(req.params);
    const { limit } = MovementsQuery.parse(req.query ?? {});

    const item = await prisma.item.findFirst({
      where: { id: itemId, tenantId },
      select: { id: true, isStock: true },
    });

    if (!item) return reply.code(404).send({ error: "item_not_found" });
    if (!item.isStock) return reply.code(400).send({ error: "item_is_not_stock_tracked" });

    const moves = await prisma.inventoryMovement.findMany({
      where: { tenantId, itemId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        type: true,
        qtyDelta: true,
        unitCostMinor: true,
        note: true,
        actorUserId: true,
        createdAt: true,
      },
    });

    return reply.code(200).send({
      movements: moves.map((m) => ({
        id: m.id,
        type: m.type,
        qtyDelta: m.qtyDelta.toString(),
        unitCostMinor: m.unitCostMinor === null ? null : m.unitCostMinor.toString(),
        note: m.note,
        actorUserId: m.actorUserId,
        createdAt: m.createdAt,
      })),
    });
  });

  // Write: adjustment
  app.post("/inventory/adjust", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const body = AdjustBody.parse(req.body);

    const qtyDelta = toBigInt(body.qtyDelta);
    if (qtyDelta === 0n) {
      const err: any = new Error("qtyDelta_must_not_be_zero");
      err.statusCode = 400;
      throw err;
    }

    const unitCostMinor = body.unitCostMinor !== undefined ? toBigInt(body.unitCostMinor) : undefined;

    if (qtyDelta > 0n && (unitCostMinor === undefined || unitCostMinor < 0n)) {
      const err: any = new Error("unitCostMinor_required_for_inbound");
      err.statusCode = 400;
      throw err;
    }

    const result = await prisma.$transaction(async (tx) => {
      // Setting: default false
      const setting = await tx.tenantSetting.upsert({
        where: { tenantId },
        update: {},
        create: { tenantId, allowNegativeStock: false },
        select: { allowNegativeStock: true },
      });

      const item = await tx.item.findFirst({
        where: { id: body.itemId, tenantId },
        select: { id: true, isStock: true },
      });

      if (!item) {
        const err: any = new Error("item_not_found");
        err.statusCode = 404;
        throw err;
      }

      if (!item.isStock) {
        const err: any = new Error("item_is_not_stock_tracked");
        err.statusCode = 400;
        throw err;
      }

      const bal = await tx.inventoryBalance.findFirst({
        where: { itemId: item.id, tenantId },
        select: { id: true, qtyOnHand: true, avgCostMinor: true },
      });

      if (!bal) {
        const err: any = new Error("inventory_balance_missing");
        err.statusCode = 500;
        throw err;
      }

      const newQty = bal.qtyOnHand + qtyDelta;

      if (!setting.allowNegativeStock && newQty < 0n) {
        const err: any = new Error("negative_stock_not_allowed");
        err.statusCode = 400;
        throw err;
      }

      let newAvg = bal.avgCostMinor;

      // Weighted average update only for inbound adjustments
      if (qtyDelta > 0n && unitCostMinor !== undefined) {
        const oldValue = bal.qtyOnHand * bal.avgCostMinor;
        const inValue = qtyDelta * unitCostMinor;
        newAvg = newQty === 0n ? 0n : (oldValue + inValue) / newQty;
      }

      const updatedBalance = await tx.inventoryBalance.update({
        where: { id: bal.id },
        data: { qtyOnHand: newQty, avgCostMinor: newAvg },
        select: { itemId: true, qtyOnHand: true, avgCostMinor: true, updatedAt: true },
      });

      const move = await tx.inventoryMovement.create({
        data: {
          tenantId,
          itemId: item.id,
          type: "ADJUSTMENT",
          qtyDelta,
          unitCostMinor: unitCostMinor,
          note: body.note,
          actorUserId: userId,
        },
        select: { id: true, createdAt: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "inventory.adjust",
          entityType: "InventoryMovement",
          entityId: move.id,
          ip: (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip,
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { itemId: item.id, qtyDelta: qtyDelta.toString() },
        },
      });

      return { updatedBalance, moveId: move.id };
    });

    return reply.code(200).send({
      balance: {
        itemId: result.updatedBalance.itemId,
        qtyOnHand: result.updatedBalance.qtyOnHand.toString(),
        avgCostMinor: result.updatedBalance.avgCostMinor.toString(),
        updatedAt: result.updatedBalance.updatedAt,
      },
      movementId: result.moveId,
    });
  });
}
