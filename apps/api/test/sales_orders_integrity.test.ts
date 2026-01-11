import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

describe("M0.3C Sales Orders reservation integrity", () => {
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

  async function availability(token: string, itemId: string) {
    const r = await app.inject({
      method: "GET",
      url: `/items/${itemId}/availability`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(r.statusCode).toBe(200);
    return r.json() as any;
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
    const id = (j?.salesOrder?.id ?? j?.id) as string;
    expect(id).toBeTypeOf("string");
    return id;
  }

  it("confirm is idempotent (no double-reserve); cancel is idempotent (no double-release)", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000);

    const soId = await createSO(token, [{ itemId, qty: 3 }]);

    const c1 = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c1.statusCode).toBe(200);

    const a1 = await availability(token, itemId);
    expect(a1.qtyOnHand).toBe("10");
    expect(a1.qtyReserved).toBe("3");
    expect(a1.qtyAvailable).toBe("7");

    const c2 = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c2.statusCode).toBe(200);

    const a2 = await availability(token, itemId);
    expect(a2.qtyReserved).toBe("3");
    expect(a2.qtyAvailable).toBe("7");

    const x1 = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(x1.statusCode).toBe(200);

    const a3 = await availability(token, itemId);
    expect(a3.qtyReserved).toBe("0");
    expect(a3.qtyAvailable).toBe("10");

    const x2 = await app.inject({
      method: "POST",
      url: `/sales-orders/${soId}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(x2.statusCode).toBe(200);

    const a4 = await availability(token, itemId);
    expect(a4.qtyReserved).toBe("0");
    expect(a4.qtyAvailable).toBe("10");
  });
});
