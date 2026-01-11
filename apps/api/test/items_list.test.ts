import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

describe("m0.2D items list enrichment", () => {
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
      payload: { email, password: "password123", tenantName: "List Store" },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as any).session.token as string;
  }

  async function createItem(token: string, sku: string, nameEn: string) {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { sku, nameEn, isStock: true },
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as any).item.id as string;
  }

  async function adjust(token: string, itemId: string, qtyDelta: number, unitCostMinor?: number) {
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

  it("GET /items returns balances as strings and supports pagination", async () => {
    const token = await signup("itemslist@example.com");

    const id1 = await createItem(token, "SKU-001", "First");
    const id2 = await createItem(token, "SKU-002", "Second");
    const id3 = await createItem(token, "SKU-003", "Third");

    // Add stock to SKU-002 so we can validate balance is returned
    const a = await adjust(token, id2, 10, 1500);
    expect(a.statusCode).toBe(200);

    const page1 = await app.inject({
      method: "GET",
      url: "/items?limit=2&page=1",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(page1.statusCode).toBe(200);
    const j1 = page1.json() as any;
    expect(j1.page).toBe(1);
    expect(j1.limit).toBe(2);
    expect(j1.total).toBe(3);
    expect(j1.items.length).toBe(2);

    // newest-first: third then second
    expect(j1.items[0].sku).toBe("SKU-003");
    expect(j1.items[1].sku).toBe("SKU-002");

    // balance should exist and be strings
    expect(j1.items[1].balance.qtyOnHand).toBe("10");
    expect(j1.items[1].balance.avgCostMinor).toBe("1500");

    const page2 = await app.inject({
      method: "GET",
      url: "/items?limit=2&page=2",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(page2.statusCode).toBe(200);
    const j2 = page2.json() as any;
    expect(j2.page).toBe(2);
    expect(j2.items.length).toBe(1);
    expect(j2.items[0].sku).toBe("SKU-001");
  });

  it("GET /items supports search by SKU/name", async () => {
    const token = await signup("itemssearch@example.com");

    await createItem(token, "SKU-AAA", "Alpha");
    await createItem(token, "SKU-BBB", "Bravo");
    await createItem(token, "SKU-CCC", "Charlie");

    const resSku = await app.inject({
      method: "GET",
      url: "/items?q=bbb",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resSku.statusCode).toBe(200);
    const jSku = resSku.json() as any;
    expect(jSku.total).toBe(1);
    expect(jSku.items[0].sku).toBe("SKU-BBB");

    const resName = await app.inject({
      method: "GET",
      url: "/items?q=char",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(resName.statusCode).toBe(200);
    const jName = resName.json() as any;
    expect(jName.total).toBe(1);
    expect(jName.items[0].sku).toBe("SKU-CCC");
  });
});
