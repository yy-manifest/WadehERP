import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";

describe("m0.2B tenant settings", () => {
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
        email: "settings@example.com",
        password: "password123",
        tenantName: "Settings Store",
      },
    });

    expect(res.statusCode).toBe(201);
    const json = res.json() as any;
    return json.session.token as string;
  }

  async function createItem(token: string) {
    const res = await app.inject({
      method: "POST",
      url: "/items",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { sku: "SKU-NS", nameEn: "Negative Stock Item", isStock: true },
    });

    expect(res.statusCode).toBe(201);
    return (res.json() as any).item.id as string;
  }

  it("GET /settings/tenant defaults allowNegativeStock=false", async () => {
    const token = await signupAndGetToken();

    const res = await app.inject({
      method: "GET",
      url: "/settings/tenant",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json() as any;
    expect(json).toHaveProperty("setting.allowNegativeStock", false);
  });

  it("PUT /settings/tenant sets allowNegativeStock=true and negative adjust becomes allowed", async () => {
    const token = await signupAndGetToken();
    const itemId = await createItem(token);

    // Default: negative stock blocked
    const blocked = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { itemId, qtyDelta: -1, note: "blocked by default" },
    });

    expect(blocked.statusCode).toBe(400);
    expect((blocked.json() as any).error).toBe("negative_stock_not_allowed");

    // Enable negative stock
    const setRes = await app.inject({
      method: "PUT",
      url: "/settings/tenant",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { allowNegativeStock: true },
    });

    expect(setRes.statusCode).toBe(200);
    expect((setRes.json() as any).setting.allowNegativeStock).toBe(true);

    // Now negative adjust should be allowed
    const allowed = await app.inject({
      method: "POST",
      url: "/inventory/adjust",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      payload: { itemId, qtyDelta: -1, note: "now allowed" },
    });

    expect(allowed.statusCode).toBe(200);
    const j = allowed.json() as any;
    expect(j.balance.qtyOnHand).toBe("-1");
  });
});
