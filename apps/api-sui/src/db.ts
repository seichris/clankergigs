import { PrismaClient } from "../prisma/generated/client/index.js";

let prisma: PrismaClient | null = null;

export function getPrisma() {
  if (!prisma) prisma = new PrismaClient();
  return prisma;
}
