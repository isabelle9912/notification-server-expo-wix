import "dotenv/config";
import { Worker } from "bullmq";
import { connection } from "./lib/queue";
import { prisma } from "./lib/prisma";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import { PushToken } from "@prisma/client";
import express from "express";

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

// --- SERVIDOR PARA MANTER O RENDER VIVO ---
const app = express();
const PORT = process.env.PORT || 4000; // Usa a porta que o Render der ou 4000

app.get("/", (req: express.Request, res: express.Response) => {
  res.send("Worker is running! 👷");
});

app.get("/health", (req: express.Request, res: express.Response) => {
  res.status(200).send("OK");
});

app.listen(PORT, () => {
  console.log(`👷 Worker Web Server rodando na porta ${PORT}`);
});
// ------------------------------------------------

console.log("Worker de notificações iniciado...");

const worker = new Worker(
  "notifications",
  async (job: any) => {
    const { title, postId, excerpt, route } = job.data;

    console.log(`[Worker] Processando post: ${title}`);

    // 1. Idempotência (SÓ SE TIVER POST ID)
    // Se for aviso geral, pulamos essa verificação para permitir mandar o mesmo aviso 2x se quiser
    if (postId) {
      const existingTicket = await prisma.notificationTicket.findFirst({
        where: { postId },
      });
      if (existingTicket) {
        console.log(`[Worker] Post ${postId} já processado. Pulando.`);
        return;
      }
    }

    // --- LÓGICA DE PAGINAÇÃO (BATCHING) ---
    const BATCH_SIZE = 1000; // Processa de 1000 em 1000 (Baixo consumo de RAM)
    let cursor: number | undefined = undefined;
    let totalProcessed = 0;

    while (true) {
      console.log(
        `[Worker] Buscando lote de tokens... (Cursor: ${cursor || "Inicio"})`
      );

      // Busca paginada usando Cursor (Mais rápido que OFFSET)
      const batchTokens: PushToken[] = await prisma.pushToken.findMany({
        take: BATCH_SIZE,
        skip: cursor ? 1 : 0, // Pula o cursor anterior
        cursor: cursor ? { id: cursor } : undefined,
        orderBy: { id: "asc" }, // Ordenação obrigatória para cursor funcionar
      });

      if (batchTokens.length === 0) {
        break; // Acabaram os tokens
      }

      console.log(
        `[Worker] Processando lote de ${batchTokens.length} usuários...`
      );

      // --- PROCESSAMENTO DO LOTE ATUAL ---

      // Mapa local apenas para este lote
      const tokenToDbIdMap = new Map(
        batchTokens.map((t: PushToken) => [t.token, t.id])
      );

      const messages: ExpoPushMessage[] = [];

      for (const tokenRecord of batchTokens) {
        if (!Expo.isExpoPushToken(tokenRecord.token)) continue;

        // Montamos o objeto de dados (Payload)
        const messageData: any = {};

        // Se tem post, manda o ID
        if (postId) messageData.postId = postId;

        // Se tem rota específica (ex: "Loja", "Biblioteca"), manda a rota
        if (route) messageData.route = route;

        messages.push({
          to: tokenRecord.token,
          sound: "default",
          title: title,
          body: excerpt,
          data: messageData,
          priority: "high",
          channelId: "default",
        });
      }

      // -- TESTE DE CARGA (Mantido dentro do loop) --
      const isTestMode = process.env.TEST_MODE === "true";
      if (isTestMode) {
        console.log(`⚠️ [MODO TESTE] Simulando lote de ${messages.length}...`);
        await new Promise((resolve) => setTimeout(resolve, 200));
        const fakeTickets = messages.map((msg) => ({
          expoTicketId: `fake-${Date.now()}-${Math.random()}`,
          pushTokenId: tokenToDbIdMap.get(msg.to as string)!,
          postId,
        }));
        await prisma.notificationTicket.createMany({ data: fakeTickets });
        // Atualiza o cursor para o próximo loop (mesmo em teste)
        cursor = batchTokens[batchTokens.length - 1].id;
        continue; // Vai para o próximo lote
      }
      // ---------------------------------------------

      // Envio do Lote para a Expo
      const chunks = expo.chunkPushNotifications(messages);
      const tokensToRemove: string[] = [];
      const ticketsToSave: any[] = [];

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

      // Salva resultados deste lote
      if (ticketsToSave.length > 0) {
        // Mapeamos para garantir que se postId for undefined, enviamos null
        const ticketsFormatted = ticketsToSave.map((t) => ({
          ...t,
          postId: postId || null, // Garante compatibilidade com o banco
          route: route || null,
        }));

        await prisma.notificationTicket.createMany({ data: ticketsFormatted });
      }

      if (tokensToRemove.length > 0) {
        await prisma.pushToken.deleteMany({
          where: { token: { in: tokensToRemove } },
        });
      }

      totalProcessed += batchTokens.length;

      // PREPARA O PRÓXIMO LOOP
      // O cursor vira o ID do último item processado
      cursor = batchTokens[batchTokens.length - 1].id;

      // Pequena pausa para liberar o Event Loop (bom para servidores fracos)
      await new Promise((resolve) => setImmediate(resolve));
    }

    console.log(
      `[Worker] Job Finalizado. Total processado: ${totalProcessed} usuários.`
    );
  },
  {
    connection,
    // --- MODO ULTRA ECONÔMICO ---
    concurrency: 1, // Processa 1 por vez (reduz conexões simultâneas)

    // Verifica jobs travados a cada 5 minutos (padrão é muito rápido)
    // Isso reduz DRASTICAMENTE as leituras no Redis
    lockDuration: 60000, // Aumentamos o lock pois lotes grandes demoram mais
    stalledInterval: 300000, // 5 minutos
    drainDelay: 15000, // 15 segundos
  }
);
