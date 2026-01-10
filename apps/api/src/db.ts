import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Always load the API .env regardless of where the process is started from
dotenv.config({ path: new URL("../.env", import.meta.url) });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is missing. Ensure apps/api/.env exists and is valid.");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

export const prisma = new PrismaClient({ adapter });
