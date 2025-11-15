import { prisma } from "./lib/prisma";

/**
 * Retorna um objeto Date representando 1 hora atrás.
 * (Usamos 1 hora para garantir que não vamos tocar nos
 * tickets que o check-receipts pode estar processando AGORA)
 */
const get1HourAgo = () => {
  const d = new Date();
  d.setHours(d.getHours() - 1);
  return d;
};

async function cleanupOldTickets() {
  console.log("Iniciando limpeza de tickets antigos (mais de 1 hora)...");

  // Deleta TODOS os tickets mais antigos que 1 hora atrás
  const result = await prisma.notificationTicket.deleteMany({
    where: {
      createdAt: {
        lt: get1HourAgo(), // 'lt' = "less than" (menor que)
      },
    },
  });

  console.log(
    `Limpeza concluída. ${result.count} tickets antigos foram removidos.`
  );
}

cleanupOldTickets()
  .catch((e) => {
    console.error("Erro ao limpar tickets antigos:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
