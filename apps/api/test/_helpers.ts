import { buildApp } from "../src/app";
import { prisma } from "../src/db";

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

export async function resetDb() {
  // Use TRUNCATE so AuditEvent immutability triggers (DELETE/UPDATE) don't break test cleanup.
  // TRUNCATE does not fire DELETE triggers in Postgres.
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "Session", "AuditEvent", "User", "Tenant" RESTART IDENTITY CASCADE;'
  );
}

export async function closeAll(app: any) {
  if (app) await app.close();
  await prisma.$disconnect();
}
