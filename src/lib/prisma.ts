import { PrismaClient } from "@prisma/client";

// Garante que teremos apenas uma instância do PrismaClient na aplicação
export const prisma = new PrismaClient();
