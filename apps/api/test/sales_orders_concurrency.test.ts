import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

function randEmail() {
  return `u${Math.random().toString(16).slice(2)}@example.com`;
}

function jsonOrBody(res: any) {
  try {
    return res.headers?.["content-type"]?.includes("application/json") ? res.json() : res.body;
  } catch {
    return res.body;
  }
}

describe("M0.3D Sales Orders confirm concurrency", () => {
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
    return (j?.salesOrder?.id ?? j?.id) as string;
  }

  it("parallel confirms do not double-reserve", async () => {
    const token = await signup();
    const itemId = await createStockItem(token);
    await inboundAdjust(token, itemId, 10, 1000);

    const soId = await createSO(token, [{ itemId, qty: 3 }]);

    const confirm = () =>
      app.inject({
        method: "POST",
        url: `/sales-orders/${soId}/confirm`,
        headers: { authorization: `Bearer ${token}` },
      });

    const [a, b] = await Promise.all([confirm(), confirm()]);

    // With advisory lock + idempotent confirm, BOTH should be 200.
    if (a.statusCode !== 200 || b.statusCode !== 200) {
      throw new Error(
        `unexpected confirm statuses: A=${a.statusCode} body=${JSON.stringify(jsonOrBody(a))} | B=${b.statusCode} body=${JSON.stringify(
          jsonOrBody(b)
        )}`
      );
    }

    const avail = await app.inject({
      method: "GET",
      url: `/items/${itemId}/availability`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(avail.statusCode).toBe(200);
    const j = avail.json() as any;
    expect(j.qtyReserved).toBe("3");
    expect(j.qtyAvailable).toBe("7");
  });
});
