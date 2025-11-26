import { Expo, ExpoPushReceipt } from "expo-server-sdk";
import { prisma } from "../lib/prisma";
import { NotificationTicket } from "@prisma/client";

const expo = new Expo();

/**
 * Retorna um objeto Date representando 24 horas atrás.
 */
const get24HoursAgo = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1); // Subtrai 1 dia
  return d;
};

async function checkNotificationReceipts() {
  console.log("Iniciando verificação de recibos (tickets das últimas 24h)...");

  // 1. Pega todos os tickets criados nas últimas 24h
  // (Não podemos mais usar 'status', então usamos 'createdAt')
  const recentTickets = await prisma.notificationTicket.findMany({
    where: {
      createdAt: {
        gte: get24HoursAgo(), // 'gte' = "greater than or equal" (maior ou igual)
      },
    },
    include: { pushToken: true }, // Inclui o token associado
  });

  if (recentTickets.length === 0) {
    console.log("Nenhum recibo recente para verificar. Encerrando.");
    return;
  }

  const receiptIds = recentTickets.map(
    (t: NotificationTicket) => t.expoTicketId
  );
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

  console.log(`Verificando ${receiptIds.length} recibos...`);

  // Usamos Sets para evitar deleções duplicadas e melhorar a performance
  const pushTokenIdsToDelete = new Set<number>();
  const ticketIdsToDelete = new Set<number>();

  // 2. Busca os recibos na Expo
  for (const chunk of receiptIdChunks) {
    try {
      const receipts: { [id: string]: ExpoPushReceipt } =
        await expo.getPushNotificationReceiptsAsync(chunk);

      // 3. Processa cada recibo
      for (const receiptId in receipts) {
        const receipt = receipts[receiptId];
        const correspondingTicket = recentTickets.find(
          (t) => t.expoTicketId === receiptId
        );

        if (!correspondingTicket) continue;

        // Marcamos o ticket para deleção, pois já foi processado (seja 'ok' ou 'error')
        // Isso evita que ele seja checado de novo amanhã.
        ticketIdsToDelete.add(correspondingTicket.id);

        if (receipt.status === "error") {
          console.error(`Erro no recibo: ${receipt.message}`);

          if (receipt.details?.error === "DeviceNotRegistered") {
            // O token é inválido. MARCA o token para remoção.
            console.log(
              `Token inválido detectado: ${correspondingTicket.pushToken.token}. Marcando para remoção...`
            );
            // Adiciona o ID do token ao Set
            pushTokenIdsToDelete.add(correspondingTicket.pushTokenId);
          }
          // Não precisamos mais atualizar o 'status' para 'error',
          // pois o ticket será apagado
        } else if (receipt.status === "ok") {
          // Ótimo, notificação entregue. O ticket será limpo (apagado).
        }
      }
    } catch (error) {
      console.error("Erro ao buscar recibos da Expo:", error);
    }
  }

  // 4. Executa as deleções em massa (muito mais eficiente)
  if (pushTokenIdsToDelete.size > 0) {
    const ids = [...pushTokenIdsToDelete];
    console.log(`Removendo ${ids.length} tokens inválidos...`, ids);
    await prisma.pushToken.deleteMany({
      where: { id: { in: ids } },
    });
  }

  if (ticketIdsToDelete.size > 0) {
    const ids = [...ticketIdsToDelete];
    console.log(`Limpando ${ids.length} tickets já processados...`);
    await prisma.notificationTicket.deleteMany({
      where: { id: { in: ids } },
    });
  }

  console.log("Verificação de recibos concluída.");
}

// Executa a função e trata possíveis erros
checkNotificationReceipts().catch((e) => {
  console.error(e);
  process.exit(1);
});
