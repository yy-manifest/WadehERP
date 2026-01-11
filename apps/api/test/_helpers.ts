import { buildApp } from "../src/app";
import { prisma } from "../src/db";

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function resetDb() {
  // Serialize resets across any pooled connections / test runners using an advisory lock.
  // Using pg_advisory_xact_lock keeps the lock tied to this transaction (auto-released).
  const sql =
    'TRUNCATE TABLE "InventoryMovement","InventoryBalance","Item","TenantSetting","Session","AuditEvent","User","Tenant" RESTART IDENTITY CASCADE;';

  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(424242);");
        await tx.$executeRawUnsafe(sql);
      });
      return;
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const isDeadlock = msg.includes("40P01") || msg.toLowerCase().includes("deadlock");
      if (!isDeadlock || attempt === 5) throw e;
      await sleep(50 * attempt);
    }
  }
}

export async function closeAll(app: any) {
  if (app) await app.close();}
