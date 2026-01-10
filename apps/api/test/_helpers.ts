import { buildApp } from "../src/app";
import { prisma } from "../src/db";

export async function makeApp() {
  const app = buildApp();
  await app.ready();
  return app;
}

export async function resetDb() {
  await prisma.session.deleteMany({});
  await prisma.auditEvent.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.tenant.deleteMany({});
}

export async function closeAll(app: any) {
  if (app) {
    await app.close();
  }
  await prisma.$disconnect();
}
