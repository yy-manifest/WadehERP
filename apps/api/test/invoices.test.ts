import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";
import { prisma } from "../src/db";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

describe("M0.4A Invoices (qty-only) + Payments blocked until pricing", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });

  beforeEach(async () => {
    await resetDb();
  });

  afterAll(async () => {
    await closeAll(app);
  });

  async function signup() {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      payload: { email: randEmail(), password: "Passw0rd!" },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as any).session.token as string;
  }

  async function createStockItem(token: string) {
    const r = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}` },
      payload: { sku: `SKU-${Math.random().toString(16).slice(2)}`, nameEn: "Item", nameAr: "Item", isStock: true },
    });
    expect(r.statusCode).toBe(201);
    return (r.json() as any).item.id as string;
  }

  async function seedInventoryForItem(itemId: string, qtyOnHand: bigint) {
    const item = await prisma.item.findFirst({ where: { id: itemId }, select: { tenantId: true } });
    if (!item) throw new Error("seedInventoryForItem: item not found");

    // InventoryBalance currently has temporary uniqueness constraints (tracked tech debt).
    // Use upsert to reduce flakiness.
    await prisma.inventoryBalance.upsert({
      where: { itemId },
      create: {
        tenantId: item.tenantId,
        itemId,
        qtyOnHand,
        qtyReserved: 0n,
        avgCostMinor: 0n,
      },
      update: {
        tenantId: item.tenantId,
        qtyOnHand,
      },
    });
  }

  it("creates qty-only invoice (totals=0) and blocks payments", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        notes: "test",
        lines: [{ itemId, qty: 2, unitPriceMinor: 0 }],
      },
    });

    expect(c.statusCode).toBe(201);
    const inv = (c.json() as any).invoice;

    expect(inv.totalMinor).toBe("0");
    expect(inv.paidMinor).toBe("0");
    expect(inv.status).toBe("UNPAID");
    expect(inv.lines.length).toBe(1);
    expect(inv.lines[0].unitPriceMinor).toBe("0");
    expect(inv.lines[0].lineTotalMinor).toBe("0");

    const invId = inv.id as string;

    const p = await app.inject({
      method: "POST",
      url: `/invoices/${invId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: 1, method: "cash" },
    });
    expect(p.statusCode).toBe(409);
  });

  it("issues invoice from CONFIRMED sales order (qty-only) and is idempotent", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);
    await seedInventoryForItem(itemId, 10n);

    const so = await app.inject({
      method: "POST",
      url: "/sales-orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { lines: [{ itemId, qty: 2 }] },
    });
    expect(so.statusCode).toBe(201);
    const soId = (so.json() as any).id as string;

    const conf = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(conf.statusCode).toBe(200);

    const i1 = await app.inject({
      method: "POST",
      url: `/invoices/from-sales-order/${soId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(i1.statusCode).toBe(201);
    const inv1 = (i1.json() as any).invoice;

    expect(inv1.salesOrderId).toBe(soId);
    expect(inv1.totalMinor).toBe("0");
    expect(inv1.status).toBe("UNPAID");

    const i2 = await app.inject({
      method: "POST",
      url: `/invoices/from-sales-order/${soId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(i2.statusCode).toBe(200);
    const inv2 = (i2.json() as any).invoice;

    expect(inv2.id).toBe(inv1.id);
  });

  it("tenant isolation: other tenant cannot read your invoice", async () => {
    const t1 = await signup();
    const t2 = await signup();
    const itemId = await createStockItem(t1);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${t1}` },
      payload: { lines: [{ itemId, qty: 1, unitPriceMinor: 0 }] },
    });
    expect(c.statusCode).toBe(201);
    const invId = (c.json() as any).invoice.id as string;

    const g = await app.inject({
      method: "GET",
      url: `/invoices/${invId}`,
      headers: { authorization: `Bearer ${t2}` },
    });
    expect(g.statusCode).toBe(404);
  });

  it("rejects priced invoices until pricing exists", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${token}` },
      payload: { lines: [{ itemId, qty: 1, unitPriceMinor: 500 }] },
    });

    expect(c.statusCode).toBe(400);
  });
});
