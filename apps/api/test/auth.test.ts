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

  async function signup() {
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
    return signupRes.json() as any;
  }

  it("signup returns token, /me works, and audit event is created", async () => {
    const signupJson = await signup();
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

  it("logout revokes session and /me stops working", async () => {
    const signupJson = await signup();
    const token = signupJson.session.token as string;

    const logoutRes = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(logoutRes.statusCode).toBe(204);

    const meRes = await app.inject({
      method: "GET",
      url: "/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(meRes.statusCode).toBe(401);

    // Audit logout exists
    const logoutAudit = await prisma.auditEvent.findFirst({
      where: {
        tenantId: signupJson.tenantId,
        actorUserId: signupJson.user.id,
        action: "auth.logout",
        entityType: "Session"
      },
      orderBy: { createdAt: "desc" },
    });

    expect(logoutAudit).not.toBeNull();
  });

  it("audit events are immutable at DB level (no update/delete)", async () => {
    const signupJson = await signup();

    const audit = await prisma.auditEvent.findFirst({
      where: { tenantId: signupJson.tenantId, action: "auth.signup" },
      orderBy: { createdAt: "desc" },
    });

    expect(audit).not.toBeNull();

    // UPDATE should fail due to trigger
    await expect(
      prisma.auditEvent.update({
        where: { id: audit!.id },
        data: { action: "tampered" },
      })
    ).rejects.toBeTruthy();

    // DELETE should fail due to trigger
    await expect(
      prisma.auditEvent.delete({
        where: { id: audit!.id },
      })
    ).rejects.toBeTruthy();
  });
});
