import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

function pickSO(j: any) {
  return (j?.salesOrder ?? j) as any;
}

describe("M0.3B Sales Orders reads", () => {
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

  async function inboundAdjust(token: string, itemId: string, qty: number, unitCostMinor: number) {
    const r = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId, qtyDelta: qty, unitCostMinor, note: "init" },
    });
    expect(r.statusCode).toBe(200);
  }

  async function createSO(token: string, lines: Array<{ itemId: string; qty: number }>) {
    const r = await app.inject({
      method: "POST",
      url: "/sales-orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { lines },
    });
    expect(r.statusCode).toBe(201);

    const j = r.json() as any;
    const so = pickSO(j);
    const id = so?.id as string;

    expect(id).toBeTypeOf("string");
    return id;
  }

  it("GET /sales-orders/:id includes lines + reservation state after confirm/cancel", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000);

    const soId = await createSO(token, [{ itemId, qty: 3 }]);

    const c = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c.statusCode).toBe(200);

    const g1 = await app.inject({
      method: "GET",
      url: `/sales-orders/${soId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(g1.statusCode).toBe(200);
    const so1 = pickSO(g1.json() as any);

    expect(so1.status).toBe("CONFIRMED");
    expect(so1.lines[0].itemId).toBe(itemId);
    expect(so1.lines[0].reservedQty).toBe("3");
    expect(so1.lines[0].reservationStatus).toBe("ACTIVE");

    const x = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(x.statusCode).toBe(200);

    const g2 = await app.inject({
      method: "GET",
      url: `/sales-orders/${soId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(g2.statusCode).toBe(200);
    const so2 = pickSO(g2.json() as any);

    expect(so2.status).toBe("CANCELLED");
    expect(so2.lines[0].reservedQty).toBe("0");
    expect(so2.lines[0].reservationStatus).toBe("CANCELLED");
  });

  it("GET /sales-orders list returns tenant-scoped results", async () => {
    const t1 = await signup();
    const t2 = await signup();

    const itemId = await createStockItem(t1);
    await inboundAdjust(t1, itemId, 10, 1000);
    await createSO(t1, [{ itemId, qty: 2 }]);

    const l1 = await app.inject({
      method: "GET",
      url: "/sales-orders?limit=20",
      headers: { authorization: `Bearer ${t1}` },
    });
    expect(l1.statusCode).toBe(200);
    expect((l1.json() as any).items.length).toBe(1);

    const l2 = await app.inject({
      method: "GET",
      url: "/sales-orders?limit=20",
      headers: { authorization: `Bearer ${t2}` },
    });
    expect(l2.statusCode).toBe(200);
    expect((l2.json() as any).items.length).toBe(0);
  });
});
