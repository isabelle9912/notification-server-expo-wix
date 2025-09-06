import express, { Request, Response, Application } from "express";
import {
  Expo,
  ExpoPushMessage,
  ExpoPushTicket,
  ExpoPushReceipt,
} from "expo-server-sdk";
import bodyParser from "body-parser";

// --- Interfaces para Tipagem dos Payloads ---

// O que esperamos receber na rota /register
interface RegisterRequestBody {
  token: string;
}

// O que esperamos receber do webhook do Wix (simplificado)
interface WixWebhookPayload {
  id: string; // id do novo post
  title: string; // titulo do post
}

// --- Inicialização ---
const app: Application = express();
const expo = new Expo({
  accessToken: process.env.EXPO_ACCESS_TOKEN,
});

// --- Configuração do servidor ---
app.use(bodyParser.json());

// --- "Banco de Dados" em Memória ---
let savedPushTokens: string[] = [];

// --- Rotas da API ---

/**
 * Rota para registrar um novo token de notificação.
 */
app.post(
  "/register",
  (req: Request<{}, {}, RegisterRequestBody>, res: Response) => {
    const { token } = req.body;

    if (!token || !Expo.isExpoPushToken(token)) {
      return res.status(400).send({ error: "Token inválido fornecido." });
    }

    if (!savedPushTokens.includes(token)) {
      savedPushTokens.push(token);
      console.log(`Token registrado: ${token}`);
    }

    res.status(200).send({ message: "Token registrado com sucesso!" });
  }
);

/**
 * Rota que receberá o webhook do Wix quando um novo post for publicado.
 */
app.post(
  "/wix-webhook",
  (req: Request<{}, {}, WixWebhookPayload>, res: Response) => {
    console.log("Webhook do Wix recebido!");

    const postTitle = req.body?.title || "Um novo post foi publicado!";
    const postId = req.body?.id;

    sendNotifications(postTitle, postId);

    res.status(200).send("Webhook processado.");
  }
);

// --- Lógica de Envio de Notificações ---

/**
 * Monta e envia as notificações, e depois processa os recibos para limpar tokens inválidos.
 * @param title - O título do post para a notificação.
 * @param id - O ID do post .
 */
async function sendNotifications(title: string, id?: string): Promise<void> {
  const messages: ExpoPushMessage[] = [];
  for (const pushToken of savedPushTokens) {
    messages.push({
      to: pushToken,
      sound: "default",
      title: "Novo Conteúdo",
      body: title,
      data: { postId: id },
    });
  }

  // ETAPA 1: Enviar as notificações em lotes (chunks)
  const chunks = expo.chunkPushNotifications(messages);
  const tickets: ExpoPushTicket[] = [];

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error("Erro ao enviar chunk de notificações:", error);
    }
  }
  console.log("Tickets recebidos:", tickets);

  // ETAPA 2: Processar os recibos para verificar a entrega
  const receiptIds: string[] = [];
  // Criamos um mapa para associar o ID do ticket ao token original
  const ticketTokenMap = new Map<string, string>();

  for (let i = 0; i < tickets.length; i++) {
    const ticket = tickets[i];
    const token = messages[i].to as string; // sabemos que 'to' é uma string aqui

    if (ticket.status === "ok") {
      receiptIds.push(ticket.id);
      ticketTokenMap.set(ticket.id, token);
    } else {
      // Trata erros que já acontecem no ticket (antes do recibo)
      const details = ticket.details;
      if (details && details.error === "DeviceNotRegistered") {
        console.log(`Token inválido (identificado no ticket): ${token}`);
        savedPushTokens = savedPushTokens.filter((t) => t !== token);
      }
    }
  }

  const receiptIdChunks = expo.chunkPushNotificationReceiptIds(receiptIds);
  for (const chunk of receiptIdChunks) {
    try {
      const receipts: { [id: string]: ExpoPushReceipt } =
        await expo.getPushNotificationReceiptsAsync(chunk);
      console.log("Recibos recebidos:", receipts);

      for (const receiptId in receipts) {
        const { status, details } = receipts[receiptId];
        if (status === "error" && details?.error === "DeviceNotRegistered") {
          const failedToken = ticketTokenMap.get(receiptId);
          if (failedToken) {
            console.log(
              `Removendo token inválido (identificado no recibo): ${failedToken}`
            );
            savedPushTokens = savedPushTokens.filter(
              (token) => token !== failedToken
            );
          }
        }
      }
    } catch (error) {
      console.error("Erro ao buscar recibos:", error);
    }
  }
}

// --- Iniciar o Servidor ---
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.listen(PORT, () => {
  console.log(`🚀 Servidor De Notificações rodando na porta ${PORT}`);
});
