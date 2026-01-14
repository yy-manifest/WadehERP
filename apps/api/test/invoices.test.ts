import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

describe("M0.4A Invoices + Payments (skeleton)", () => {
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
      payload: { email: randEmail(), password: "Password123!" },
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

  it("creates invoice with computed totals; records payments and updates status", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        notes: "test",
        lines: [{ itemId, qty: 2, unitPriceMinor: 1500 }],
      },
    });

    expect(c.statusCode).toBe(201);
    const invId = (c.json() as any).invoice.id as string;
    expect(invId).toBeTypeOf("string");
    expect((c.json() as any).invoice.totalMinor).toBe("3000");
    expect((c.json() as any).invoice.paidMinor).toBe("0");

    const p1 = await app.inject({
      method: "POST",
      url: `/invoices/${invId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: 1000, method: "cash" },
    });
    expect(p1.statusCode).toBe(201);
    expect((p1.json() as any).invoice.status).toBe("PARTIALLY_PAID");
    expect((p1.json() as any).invoice.paidMinor).toBe("1000");

    const p2 = await app.inject({
      method: "POST",
      url: `/invoices/${invId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: 2000, method: "cash" },
    });
    expect(p2.statusCode).toBe(201);
    expect((p2.json() as any).invoice.status).toBe("PAID");
    expect((p2.json() as any).invoice.paidMinor).toBe("3000");

    const g = await app.inject({
      method: "GET",
      url: `/invoices/${invId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(g.statusCode).toBe(200);
    expect((g.json() as any).invoice.status).toBe("PAID");
    expect((g.json() as any).invoice.payments.length).toBe(2);
  });

  it("tenant isolation: other tenant cannot read/pay your invoice", async () => {
    const t1 = await signup();
    const t2 = await signup();
    const itemId = await createStockItem(t1);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${t1}` },
      payload: { lines: [{ itemId, qty: 1, unitPriceMinor: 500 }] },
    });
    expect(c.statusCode).toBe(201);
    const invId = (c.json() as any).invoice.id as string;

    const g = await app.inject({
      method: "GET",
      url: `/invoices/${invId}`,
      headers: { authorization: `Bearer ${t2}` },
    });
    expect(g.statusCode).toBe(404);

    const p = await app.inject({
      method: "POST",
      url: `/invoices/${invId}/payments`,
      headers: { authorization: `Bearer ${t2}` },
      payload: { amountMinor: 100 },
    });
    expect(p.statusCode).toBe(404);
  });

  it("blocks overpayment", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);

    const c = await app.inject({
      method: "POST",
      url: "/invoices",
      headers: { authorization: `Bearer ${token}` },
      payload: { lines: [{ itemId, qty: 1, unitPriceMinor: 500 }] },
    });
    expect(c.statusCode).toBe(201);
    const invId = (c.json() as any).invoice.id as string;

    const p = await app.inject({
      method: "POST",
      url: `/invoices/${invId}/payments`,
      headers: { authorization: `Bearer ${token}` },
      payload: { amountMinor: 600 },
    });
    expect(p.statusCode).toBe(400);
  });
});
