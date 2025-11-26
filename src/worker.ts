import "dotenv/config"; // Primeira linha
import { Worker } from "bullmq";
import { connection } from "./lib/queue";
import { prisma } from "./lib/prisma";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { PushToken } from "@prisma/client";
import express from "express";

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// --- MÁGICA PARA O RENDER NÃO MATAR O WORKER ---
const app = express();
const PORT = process.env.PORT || 4000; // Usa a porta que o Render der ou 4000

app.get("/", (req: express.Request, res: express.Response) => {
  res.send("Worker is running! 👷");
});

// Endpoint para "acordar" o worker (Health Check)
app.get("/health", (req: express.Request, res: express.Response) => {
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`👷 Worker Web Server rodando na porta ${PORT}`);
});
// ------------------------------------------------

console.log("👷 Worker de notificações iniciado e aguardando jobs...");

console.log("Worker de notificações iniciado e aguardando jobs...");

const worker = new Worker(
  "notifications", // Mesmíssimo nome da fila
  async (job: any) => {
    const { title, postId, excerpt } = job.data;
    console.log(`[Worker] Processando post: ${postId}`);

    // 1. Idempotência: Já enviamos para esse post?
    const existingTicket = await prisma.notificationTicket.findFirst({
      where: { postId },
    });

    if (existingTicket) {
      console.log(`[Worker] Post ${postId} já processado. Pulando.`);
      return; // O BullMQ marca como "Completed" automaticamente
    }

    // 2. Busca Tokens
    const allTokens = await prisma.pushToken.findMany();
    if (allTokens.length === 0) return;

    // Mapa para saber qual token (string) pertence a qual ID no banco
    const tokenToDbIdMap = new Map(
      allTokens.map((t: PushToken) => [t.token, t.id])
    );

    const messages: ExpoPushMessage[] = [];

    for (const tokenRecord of allTokens) {
      if (!Expo.isExpoPushToken(tokenRecord.token)) continue;

      messages.push({
        to: tokenRecord.token,
        sound: "default",
        title: title,
        body: excerpt || "Novo conteúdo disponível!",
        data: { postId },
        priority: "high", // <--- PRIORIDADE ALTA
        channelId: "default",
      });
    }
    // -- INICIO: CRIADO PARA REALIZAR TESTES DE CARGA --
    const isTestMode = process.env.TEST_MODE === "true";

    if (isTestMode) {
      console.log(
        `⚠️ [MODO TESTE] Simulando envio para ${messages.length} dispositivos...`
      );
      // Simulamos uma latência de rede de 500ms (tempo médio da Expo)
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Fingimos que tudo deu certo e salvamos tickets falsos
      // Para testar se o banco aguenta a escrita de tickets
      const fakeTickets = messages.map((msg) => ({
        expoTicketId: `ticket-fake-${Date.now()}-${Math.random()}`,
        pushTokenId: tokenToDbIdMap.get(msg.to as string)!,
        postId,
      }));

      await prisma.notificationTicket.createMany({ data: fakeTickets });
      console.log(
        `✅ [MODO TESTE] ${fakeTickets.length} tickets falsos salvos.`
      );

      return; // <--- Encerra aqui para não chamar a Expo de verdade
    }

    // -- FIM: CRIADO PARA REALIZAR TESTES DE CARGA --

    // 3. Envio Paralelo (Otimização)
    const chunks = expo.chunkPushNotifications(messages);
    const tokensToRemove: string[] = [];
    const ticketsToSave: any[] = [];

    // Enviamos todos os chunks simultaneamente
    await Promise.all(
      chunks.map(async (chunk) => {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);

          ticketChunk.forEach((ticket, index) => {
            const tokenString = chunk[index].to as string;
            const tokenDbId = tokenToDbIdMap.get(tokenString);

            if (ticket.status === "ok" && tokenDbId) {
              ticketsToSave.push({
                expoTicketId: ticket.id,
                pushTokenId: tokenDbId,
                postId,
              });
            } else if (
              ticket.status === "error" &&
              ticket.details?.error === "DeviceNotRegistered"
            ) {
              tokensToRemove.push(tokenString);
            }
          });
        } catch (e) {
          console.error("Erro no chunk:", e);
        }
      })
    );

    // 4. Salvar Tickets e Limpar Tokens (em batch)
    if (ticketsToSave.length > 0) {
      // createMany é muito mais rápido que criar um por um
      await prisma.notificationTicket.createMany({
        data: ticketsToSave,
      });
    }

    if (tokensToRemove.length > 0) {
      await prisma.pushToken.deleteMany({
        where: { token: { in: tokensToRemove } },
      });
    }

    console.log(
      `[Worker] Finalizado. ${ticketsToSave.length} tickets gerados.`
    );
  },
  { connection }
);
