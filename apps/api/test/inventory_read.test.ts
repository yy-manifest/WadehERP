import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

describe("m0.2C inventory reads", () => {
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

  async function signup(email: string) {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "content-type": "application/json" },
      payload: { email, password: "password123", tenantName: "Store" },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as any).session.token as string;
  }

  async function createItem(token: string, sku: string) {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { sku, nameEn: "Item", isStock: true },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as any).item.id as string;
  }

  async function adjust(token: string, itemId: string, qtyDelta: any, unitCostMinor?: any) {
    const payload: any = { itemId, qtyDelta, note: "t" };
    if (unitCostMinor !== undefined) payload.unitCostMinor = unitCostMinor;

    const res = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload,
    });
    return res;
  }

  it("GET balance reflects adjustments; GET movements returns newest first", async () => {
    const token = await signup("m02c@example.com");
    const itemId = await createItem(token, "SKU-R1");

    // +10 @1500 then -3
    const a1 = await adjust(token, itemId, 10, 1500);
    expect(a1.statusCode).toBe(200);

    const a2 = await adjust(token, itemId, -3);
    expect(a2.statusCode).toBe(200);

    const balRes = await app.inject({
      method: "GET",
      url: `/items/${itemId}/balance`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(balRes.statusCode).toBe(200);
    const balJson = balRes.json() as any;
    expect(balJson.balance.qtyOnHand).toBe("7");
    // outbound doesn't change avg cost
    expect(balJson.balance.avgCostMinor).toBe("1500");

    const mvRes = await app.inject({
      method: "GET",
      url: `/items/${itemId}/movements?limit=10`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(mvRes.statusCode).toBe(200);
    const mvJson = mvRes.json() as any;
    expect(Array.isArray(mvJson.movements)).toBe(true);
    expect(mvJson.movements.length).toBe(2);

    // newest first => the -3 move should be first
    expect(mvJson.movements[0].qtyDelta).toBe("-3");
    expect(mvJson.movements[1].qtyDelta).toBe("10");
  });

  it("tenant isolation: other tenant cannot read item balance/movements", async () => {
    const tokenA = await signup("tenantA@example.com");
    const itemId = await createItem(tokenA, "SKU-ISO");
    const a1 = await adjust(tokenA, itemId, 5, 1000);
    expect(a1.statusCode).toBe(200);

    const tokenB = await signup("tenantB@example.com");

    const balRes = await app.inject({
      method: "GET",
      url: `/items/${itemId}/balance`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(balRes.statusCode).toBe(404);
    expect((balRes.json() as any).error).toBe("item_not_found");

    const mvRes = await app.inject({
      method: "GET",
      url: `/items/${itemId}/movements`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(mvRes.statusCode).toBe(404);
    expect((mvRes.json() as any).error).toBe("item_not_found");
  });
});
