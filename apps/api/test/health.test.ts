import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeAll, makeApp } from "./_helpers";

describe("health", () => {
  let app: Awaited<ReturnType<typeof makeApp>>;

  beforeAll(async () => {
    app = await makeApp();
  });

  afterAll(async () => {
    await closeAll(app);
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });
});
