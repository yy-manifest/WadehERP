import type { FastifyInstance } from "fastify";
import { prisma } from "../db";
import { requireAuth } from "../lib/auth";

export async function availabilityRoutes(app: FastifyInstance) {
  app.get("/items/:itemId/availability", async (req, reply) => {
    requireAuth(req);

    const tenantId = req.auth!.tenantId;
    const itemId = (req.params as any).itemId as string;

    const bal = await prisma.inventoryBalance.findFirst({
      where: { tenantId, itemId },
      select: { qtyOnHand: true, qtyReserved: true },
    });

    if (!bal) return reply.code(404).send({ error: "not_found" });

    const qtyOnHand = BigInt(bal.qtyOnHand);
    const qtyReserved = BigInt(bal.qtyReserved);
    const qtyAvailable = qtyOnHand - qtyReserved;

    return reply.code(200).send({
      itemId,
      qtyOnHand: qtyOnHand.toString(),
      qtyReserved: qtyReserved.toString(),
      qtyAvailable: qtyAvailable.toString(),
    });
  });
}
