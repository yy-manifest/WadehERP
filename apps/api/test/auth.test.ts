import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeAll, makeApp, resetDb } from "./_helpers";
import { prisma } from "../src/db";

describe("auth", () => {
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

  it("signup returns token, /me works, and audit event is created", async () => {
    const signupRes = await app.inject({
      method: "POST",
      url: "/auth/signup",
      headers: { "content-type": "application/json" },
      payload: {
        email: "test@example.com",
        password: "password123",
        tenantName: "Test Store",
      },
    });

    expect(signupRes.statusCode).toBe(201);
    const signupJson = signupRes.json() as any;

    expect(signupJson).toHaveProperty("tenantId");
    expect(signupJson).toHaveProperty("user.id");
    expect(signupJson).toHaveProperty("user.email", "test@example.com");
    expect(signupJson).toHaveProperty("session.token");
    expect(typeof signupJson.session.token).toBe("string");

    const token = signupJson.session.token as string;

    const meRes = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meRes.statusCode).toBe(200);
    const meJson = meRes.json() as any;

    expect(meJson).toHaveProperty("user.id", signupJson.user.id);
    expect(meJson).toHaveProperty("user.email", "test@example.com");
    expect(meJson).toHaveProperty("user.tenantId", signupJson.tenantId);

    // Audit created
    const audit = await prisma.auditEvent.findFirst({
      where: {
        tenantId: signupJson.tenantId,
        actorUserId: signupJson.user.id,
        action: "auth.signup",
        entityType: "User",
        entityId: signupJson.user.id,
      },
    });

    expect(audit).not.toBeNull();
  });

  it("GET /me without auth returns 401", async () => {
    const res = await app.inject({ method: "GET", url: "/me" });
    expect(res.statusCode).toBe(401);
  });
});
