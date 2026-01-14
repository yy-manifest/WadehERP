import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

function ipFromReq(req: any) {
  return ((req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.ip) as string;
}

function toBigInt(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  if (typeof v === "string" && v.trim() !== "") return BigInt(v);
  throw Object.assign(new Error("invalid_number"), { statusCode: 400 });
}

const CreateInvoiceBody = z.object({
  salesOrderId: z.string().min(1).optional(),
  notes: z.string().max(5000).optional(),
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
        unitPriceMinor: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
      })
    )
    .min(1),
});

const CreatePaymentBody = z.object({
  amountMinor: z.union([z.number().int().positive(), z.string().regex(/^\d+$/)]),
  method: z.string().max(50).optional(),
  reference: z.string().max(100).optional(),
  note: z.string().max(500).optional(),
});

function computeStatus(total: bigint, paid: bigint) {
  if (paid <= 0n) return "UNPAID" as const;
  if (paid >= total) return "PAID" as const;
  return "PARTIALLY_PAID" as const;
}

export async function invoicesRoutes(app: FastifyInstance) {
  // ISSUE from SalesOrder (qty-only until pricing exists)
  app.post("/invoices/from-sales-order/:salesOrderId", async (req, reply) => {
    requireAuth(req);
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const salesOrderId = (req.params as any).salesOrderId as string;

    const result = await prisma.$transaction(async (tx) => {
      // Serialize issuance per (tenantId, salesOrderId)
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));",
        tenantId,
        salesOrderId
      );

      // Idempotent: if invoice already exists for this SO, return it
      const existing = await tx.invoice.findFirst({
        where: { tenantId, salesOrderId },
        include: { lines: true, payments: true },
      });
      if (existing) return { kind: "existing" as const, invoice: existing };

      const so = await tx.salesOrder.findFirst({
        where: { tenantId, id: salesOrderId },
        select: {
          id: true,
          status: true,
          lines: { select: { itemId: true, qty: true } },
        },
      });
      if (!so) return { kind: "not_found" as const };

      if (so.status !== "CONFIRMED") {
        return { kind: "conflict" as const, message: "sales order must be CONFIRMED" };
      }

      // Qty-only invoice: totals must be 0 until pricing exists.
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          salesOrderId: so.id,
          notes: undefined,
          totalMinor: 0n,
          paidMinor: 0n,
          status: computeStatus(0n, 0n),
          lines: {
            create: so.lines.map((ln) => ({
              tenantId,
              itemId: ln.itemId,
              qty: ln.qty,
              unitPriceMinor: 0n,
              lineTotalMinor: 0n,
            })),
          },
        },
        include: { lines: true, payments: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "invoice.issue_from_sales_order",
          entityType: "Invoice",
          entityId: inv.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { salesOrderId: so.id, totalMinor: "0" },
        },
      });

      return { kind: "created" as const, invoice: inv };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "conflict") return reply.code(409).send({ error: "conflict", message: result.message });

    const statusCode = result.kind === "created" ? 201 : 200;
    return reply.code(statusCode).send({
      invoice: {
        id: result.invoice.id,
        salesOrderId: result.invoice.salesOrderId,
        status: result.invoice.status,
        totalMinor: result.invoice.totalMinor.toString(),
        paidMinor: result.invoice.paidMinor.toString(),
        lines: result.invoice.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: l.qty.toString(),
          unitPriceMinor: l.unitPriceMinor.toString(),
          lineTotalMinor: l.lineTotalMinor.toString(),
        })),
        payments: result.invoice.payments.map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor.toString(),
          method: p.method,
          reference: p.reference,
          note: p.note,
          createdAt: p.createdAt,
        })),
      },
    });
  });

  // CREATE (qty-only until pricing exists)
  app.post("/invoices", async (req, reply) => {
    requireAuth(req);
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;

    const body = CreateInvoiceBody.parse(req.body);

    // Validate itemIds belong to tenant
    const itemIds = Array.from(new Set(body.lines.map((l) => l.itemId)));
    const items = await prisma.item.findMany({
      where: { tenantId, id: { in: itemIds } },
      select: { id: true },
    });
    if (items.length !== itemIds.length) {
      return reply.code(400).send({
        error: "bad_request",
        message: "one or more itemId are invalid for this tenant",
      });
    }

    // If linking to SO, require it is CONFIRMED (issuance semantics)
    if (body.salesOrderId) {
      const so = await prisma.salesOrder.findFirst({
        where: { tenantId, id: body.salesOrderId },
        select: { id: true, status: true },
      });
      if (!so) {
        return reply.code(400).send({
          error: "bad_request",
          message: "salesOrderId is invalid for this tenant",
        });
      }
      if (so.status !== "CONFIRMED") {
        return reply
          .code(409)
          .send({ error: "conflict", message: "sales order must be CONFIRMED to issue an invoice" });
      }
    }

    const lines = body.lines.map((l) => {
      const qty = toBigInt(l.qty);

      // Pricing not supported yet: force qty-only lines and totals=0.
      const unit = toBigInt(l.unitPriceMinor);
      if (unit !== 0n) {
        throw Object.assign(new Error("pricing_not_supported_yet"), { statusCode: 400 });
      }

      return { itemId: l.itemId, qty, unitPriceMinor: 0n, lineTotalMinor: 0n };
    });

    const totalMinor = 0n;

    const created = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          tenantId,
          salesOrderId: body.salesOrderId,
          notes: body.notes?.trim(),
          totalMinor,
          paidMinor: 0n,
          status: computeStatus(totalMinor, 0n),
          lines: {
            create: lines.map((l) => ({
              tenantId,
              ...l,
            })),
          },
        },
        include: { lines: true },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "invoice.create",
          entityType: "Invoice",
          entityId: inv.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { totalMinor: totalMinor.toString(), lines: inv.lines.length },
        },
      });

      return inv;
    });

    return reply.code(201).send({
      invoice: {
        id: created.id,
        salesOrderId: created.salesOrderId,
        status: created.status,
        totalMinor: created.totalMinor.toString(),
        paidMinor: created.paidMinor.toString(),
        lines: created.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: l.qty.toString(),
          unitPriceMinor: l.unitPriceMinor.toString(),
          lineTotalMinor: l.lineTotalMinor.toString(),
        })),
      },
    });
  });

  // READ (single)
  app.get("/invoices/:id", async (req, reply) => {
    requireAuth(req);
    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id as string;

    const inv = await prisma.invoice.findFirst({
      where: { tenantId, id },
      include: { lines: true, payments: true },
    });
    if (!inv) return reply.code(404).send({ error: "not_found" });

    return reply.code(200).send({
      invoice: {
        id: inv.id,
        salesOrderId: inv.salesOrderId,
        status: inv.status,
        totalMinor: inv.totalMinor.toString(),
        paidMinor: inv.paidMinor.toString(),
        lines: inv.lines.map((l) => ({
          id: l.id,
          itemId: l.itemId,
          qty: l.qty.toString(),
          unitPriceMinor: l.unitPriceMinor.toString(),
          lineTotalMinor: l.lineTotalMinor.toString(),
        })),
        payments: inv.payments.map((p) => ({
          id: p.id,
          amountMinor: p.amountMinor.toString(),
          method: p.method,
          reference: p.reference,
          note: p.note,
          createdAt: p.createdAt,
        })),
      },
    });
  });

  // LIST payments
  app.get("/invoices/:id/payments", async (req, reply) => {
    requireAuth(req);
    const tenantId = req.auth!.tenantId;
    const id = (req.params as any).id as string;

    const inv = await prisma.invoice.findFirst({
      where: { tenantId, id },
      select: { id: true },
    });
    if (!inv) return reply.code(404).send({ error: "not_found" });

    const payments = await prisma.payment.findMany({
      where: { tenantId, invoiceId: id },
      orderBy: { createdAt: "asc" },
    });

    return reply.code(200).send({
      payments: payments.map((p) => ({
        id: p.id,
        amountMinor: p.amountMinor.toString(),
        method: p.method,
        reference: p.reference,
        note: p.note,
        createdAt: p.createdAt,
      })),
    });
  });

  // CREATE payment (updates invoice paid/status)
  app.post("/invoices/:id/payments", async (req, reply) => {
    requireAuth(req);
    const tenantId = req.auth!.tenantId;
    const userId = req.auth!.userId;
    const invoiceId = (req.params as any).id as string;

    const body = CreatePaymentBody.parse(req.body);

    const amountMinor = toBigInt(body.amountMinor);
    const method = body.method?.trim() ?? "cash";

    const result = await prisma.$transaction(async (tx) => {
      // Serialize payments per invoice to prevent races.
      await tx.$executeRawUnsafe(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2));",
        tenantId,
        invoiceId
      );

      const inv = await tx.invoice.findFirst({
        where: { tenantId, id: invoiceId },
        select: { id: true, status: true, totalMinor: true, paidMinor: true, voidedAt: true },
      });
      if (!inv) return { kind: "not_found" as const };
      if (inv.status === "VOID") return { kind: "conflict" as const, message: "invoice is void" };
      if (inv.totalMinor === 0n) return { kind: "conflict" as const, message: "invoice has no monetary total" };

      const total = BigInt(inv.totalMinor);
      const paid = BigInt(inv.paidMinor);

      const nextPaid = paid + amountMinor;
      if (nextPaid > total) return { kind: "bad_request" as const, message: "payment exceeds invoice total" };

      const nextStatus = computeStatus(total, nextPaid);

      const pay = await tx.payment.create({
        data: {
          tenantId,
          invoiceId: inv.id,
          amountMinor,
          method,
          reference: body.reference?.trim(),
          note: body.note?.trim(),
          actorUserId: userId,
        },
      });

      const updated = await tx.invoice.update({
        where: { id: inv.id },
        data: { paidMinor: nextPaid, status: nextStatus },
      });

      await tx.auditEvent.create({
        data: {
          tenantId,
          actorUserId: userId,
          action: "invoice.payment_create",
          entityType: "Invoice",
          entityId: inv.id,
          ip: ipFromReq(req),
          userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
          meta: { amountMinor: amountMinor.toString(), paidMinor: nextPaid.toString(), status: nextStatus },
        },
      });

      return { kind: "ok" as const, payment: pay, invoice: updated };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "not_found" });
    if (result.kind === "conflict") return reply.code(409).send({ error: "conflict", message: result.message });
    if (result.kind === "bad_request") return reply.code(400).send({ error: "bad_request", message: result.message });

    return reply.code(201).send({
      payment: {
        id: result.payment.id,
        amountMinor: result.payment.amountMinor.toString(),
      },
      invoice: {
        id: result.invoice.id,
        status: result.invoice.status,
        paidMinor: result.invoice.paidMinor.toString(),
        totalMinor: result.invoice.totalMinor.toString(),
      },
    });
  });
}
