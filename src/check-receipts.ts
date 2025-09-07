import { Expo, ExpoPushReceipt } from "expo-server-sdk";
import { prisma } from "./lib/prisma";

const expo = new Expo();

async function checkNotificationReceipts() {
  console.log("Iniciando verificação de recibos de notificação...");

  // 1. Pega todos os tickets pendentes do banco
  const pendingTickets = await prisma.notificationTicket.findMany({
    where: { status: "pending" },
    include: { pushToken: true }, // Inclui o token associado
  });

  if (pendingTickets.length === 0) {
    console.log("Nenhum recibo pendente para verificar. Encerrando.");
    return;
  }

  const receiptIds = pendingTickets.map((t) => t.expoTicketId);
  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);

  // 2. Busca os recibos na Expo
  for (const chunk of receiptIdChunks) {
    try {
      const receipts: { [id: string]: ExpoPushReceipt } =
        await expo.getPushNotificationReceiptsAsync(chunk);

      // 3. Processa cada recibo
      for (const receiptId in receipts) {
        const receipt = receipts[receiptId];
        const correspondingTicket = pendingTickets.find(
          (t) => t.expoTicketId === receiptId
        );

        if (!correspondingTicket) continue;

        if (receipt.status === "ok") {
          // Notificação entregue com sucesso! Marca o ticket como 'ok'
          await prisma.notificationTicket.update({
            where: { id: correspondingTicket.id },
            data: { status: "ok" },
          });
        } else if (receipt.status === "error") {
          console.error(`Erro no recibo: ${receipt.message}`);
          if (receipt.details?.error === "DeviceNotRegistered") {
            // O token é inválido. REMOVE o token do banco de dados.
            console.log(
              `Token inválido detectado: ${correspondingTicket.pushToken.token}. Removendo...`
            );
            await prisma.pushToken.delete({
              where: { id: correspondingTicket.pushTokenId },
            });
          } else {
            // Outro tipo de erro, marca o ticket como 'error'
            await prisma.notificationTicket.update({
              where: { id: correspondingTicket.id },
              data: { status: "error" },
            });
          }
        }
      }
    } catch (error) {
      console.error("Erro ao buscar recibos da Expo:", error);
    }
  }

  console.log("Verificação de recibos concluída.");
}

// Executa a função e trata possíveis erros
checkNotificationReceipts().catch((e) => {
  console.error(e);
  process.exit(1);
});
