import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";
import { prisma } from "../src/db";

describe("m0.2 items + inventory", () => {
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

  async function signupAndGetToken() {
    const res = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "content-type": "application/json" },
      payload: {
        email: "m02@example.com",
        password: "password123",
        tenantName: "M0.2 Store",
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json() as any;
    expect(json).toHaveProperty("session.token");
    return json.session.token as string;
  }

  async function createItem(token: string) {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: {
        sku: "SKU-001",
        nameEn: "Test Item",
        nameAr: "اختبار",
        isStock: true,
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json() as any;
    expect(json).toHaveProperty("item.id");
    return json.item.id as string;
  }

  it("creates item and auto-creates inventory balance", async () => {
    const token = await signupAndGetToken();
    const itemId = await createItem(token);

    const bal = await prisma.inventoryBalance.findFirst({
      where: { itemId },
      select: { qtyOnHand: true, avgCostMinor: true },
    });

    expect(bal).not.toBeNull();
    expect(bal!.qtyOnHand).toBe(0n);
    expect(bal!.avgCostMinor).toBe(0n);

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "item.create", entityType: "Item", entityId: itemId },
    });

    expect(audit).not.toBeNull();
  });

  it("inbound adjustments update qty and weighted average cost", async () => {
    const token = await signupAndGetToken();
    const itemId = await createItem(token);

    // +10 @ 1500 => avg 1500
    const a1 = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { itemId, qtyDelta: 10, unitCostMinor: 1500, note: "init" },
    });

    expect(a1.statusCode).toBe(200);
    const j1 = a1.json() as any;
    expect(j1.balance.qtyOnHand).toBe("10");
    expect(j1.balance.avgCostMinor).toBe("1500");

    // +10 @ 500 => avg = (10*1500 + 10*500)/20 = 1000
    const a2 = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { itemId, qtyDelta: 10, unitCostMinor: 500, note: "restock" },
    });

    expect(a2.statusCode).toBe(200);
    const j2 = a2.json() as any;
    expect(j2.balance.qtyOnHand).toBe("20");
    expect(j2.balance.avgCostMinor).toBe("1000");

    const audit = await prisma.auditEvent.findFirst({
      where: { action: "inventory.adjust", entityType: "InventoryMovement" },
    });

    expect(audit).not.toBeNull();
  });

  it("negative stock is blocked by default", async () => {
    const token = await signupAndGetToken();
    const itemId = await createItem(token);

    const res = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { itemId, qtyDelta: -1, note: "should fail" },
    });

    expect(res.statusCode).toBe(400);
    expect((res.json() as any).error).toBe("negative_stock_not_allowed");
  });
});
