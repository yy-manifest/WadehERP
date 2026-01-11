import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

describe("M0.3A Sales Orders (reservations)", () => {
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
    const j = res.json() as any;

    const token = j?.session?.token as string;
    expect(token).toBeTypeOf("string");

    return token;
  }

  async function createStockItem(token: string) {
    const r = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        sku: `SKU-${Math.random().toString(16).slice(2)}`,
        nameEn: "Item",
        nameAr: "Item",
        isStock: true,
      },
    });

    expect(r.statusCode).toBe(201);
    const j = r.json() as any;

    const itemId = j?.item?.id as string;
    expect(itemId).toBeTypeOf("string");

    return itemId;
  }

  async function inboundAdjust(token: string, itemId: string, qty: number, unitCostMinor: number, note = "init") {
    const r = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}` },
      payload: { itemId, qtyDelta: qty, unitCostMinor, note },
    });

    if (r.statusCode !== 200) {
      throw new Error("inventory/adjust failed: " + r.statusCode + " " + r.body);
    }
  }

  async function createSO(token: string, lines: Array<{ itemId: string; qty: number }>) {
    const r = await app.inject({
      method: "POST",
      url: "/sales-orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { lines },
    });

    if (r.statusCode !== 201) {
      throw new Error("sales-orders create failed: " + r.statusCode + " " + r.body);
    }

    const j = r.json() as any;
    const id = (j?.salesOrder?.id ?? j?.id) as string;
    if (typeof id !== "string") throw new Error("sales-orders create missing id: " + JSON.stringify(j));

    return id;
  }

  it("reserves stock on confirm; blocks oversell when allowNegativeStock=false (default)", async () => {
    const token = await signup();

    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000, "init");

    const so1 = await createSO(token, [{ itemId, qty: 7 }]);

    const c1 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(c1.statusCode).toBe(200);
    expect((c1.json() as any).status).toBe("CONFIRMED");
    const so2 = await createSO(token, [{ itemId, qty: 4 }]);

    const c2 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so2}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(c2.statusCode).toBe(400);
  });

  it("allowNegativeStock=true allows confirm even if it oversells available stock", async () => {
    const token = await signup();

    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000, "init");

    const so1 = await createSO(token, [{ itemId, qty: 9 }]);

    const c1 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c1.statusCode).toBe(200);

    const set = await app.inject({
      method: "PUT",
      url: "/settings/tenant",
      headers: { authorization: `Bearer ${token}` },
      payload: { allowNegativeStock: true },
    });
    expect(set.statusCode).toBe(200);

    const so2 = await createSO(token, [{ itemId, qty: 9 }]);

    const c2 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so2}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c2.statusCode).toBe(200);
  });

  it("cancel releases reservations (confirmed -> cancelled), enabling subsequent confirm without oversell", async () => {
    const token = await signup();

    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000, "init");

    const so1 = await createSO(token, [{ itemId, qty: 7 }]);

    const c1 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c1.statusCode).toBe(200);

    const x = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/cancel`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(x.statusCode).toBe(200);

    const so2 = await createSO(token, [{ itemId, qty: 10 }]);

    const c2 = await app.inject({
      method: "POST",
      url: `/sales-orders/${so2}/confirm`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(c2.statusCode).toBe(200);
  });

  it("tenant isolation: other tenant cannot read/confirm/cancel your sales order", async () => {
    const token1 = await signup();
    const token2 = await signup();

    const itemId = await createStockItem(token1);
    await inboundAdjust(token1, itemId, 10, 1500, "init");

    const so1 = await createSO(token1, [{ itemId, qty: 3 }]);

    const rGet = await app.inject({
      method: "GET",
      url: `/sales-orders/${so1}`,
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(rGet.statusCode).toBe(404);

    const rConfirm = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/confirm`,
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(rConfirm.statusCode).toBe(404);

    const rCancel = await app.inject({
      method: "POST",
      url: `/sales-orders/${so1}/cancel`,
      headers: { authorization: `Bearer ${token2}` },
    });
    expect(rCancel.statusCode).toBe(404);
  });
});
