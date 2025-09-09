import "dotenv/config"; // ESSA DEVE SER A PRIMEIRA LINHA DO ARQUIVO
import express, { Request, Response, Application } from "express";
import { Expo, ExpoPushMessage } from "expo-server-sdk";
import bodyParser from "body-parser";
import { prisma } from "./lib/prisma"; // Importamos a instância do Prisma

// --- Interfaces (sem alteração) ---
interface RegisterRequestBody {
  token: string;
}
interface WixWebhookPayload {
  data: {
    id: string;
    title: string;
    excerpt: string | null;
  };
}

// --- Inicialização ---
const app: Application = express();
const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
app.use(bodyParser.json());

// --- Rotas da API ---

/**
 * Rota para registrar um novo token no BANCO DE DADOS.
 */
app.post(
  "/register",
  async (req: Request<{}, {}, RegisterRequestBody>, res: Response) => {
    const { token } = req.body;

    if (!token || !Expo.isExpoPushToken(token)) {
      return res.status(400).send({ error: "Token inválido fornecido." });
    }

    try {
      // Usamos o `upsert` do Prisma:
      // - Tenta encontrar um token. Se existir, não faz nada (`update: {}`).
      // - Se não existir, cria um novo registro.
      await prisma.pushToken.upsert({
        where: { token },
        update: {},
        create: { token },
      });

      console.log(`Token registrado ou atualizado: ${token}`);
      res.status(200).send({ message: "Token registrado com sucesso!" });
    } catch (error) {
      console.error("Erro ao registrar token no banco de dados:", error);
      res.status(500).send({ error: "Não foi possível registrar o token." });
    }
  }
);

/**
 * Rota que receberá o webhook do Wix.
 */
app.post(
  "/wix-webhook",
  (req: Request<{}, {}, WixWebhookPayload>, res: Response) => {
    console.log("Webhook do Wix recebido:", req.body);
    const { title, id, excerpt } = req.body.data;

    if (!title || !id) {
      return res
        .status(400)
        .send({ error: "Título (title) e ID (id) do post são obrigatórios." });
    }

    sendNotifications(title, id, excerpt);
    res.status(200).send("Webhook processado.");
  }
);

// --- Lógica de Envio de Notificações ---

async function sendNotifications(
  title: string,
  id: string,
  excerpt: string | null
): Promise<void> {
  console.log("Buscando todos os tokens do banco de dados...");
  const allTokens = await prisma.pushToken.findMany();

  if (allTokens.length === 0) {
    console.log("Nenhum token registrado para enviar notificações.");
    return;
  }

  // Criar um mapa para busca rápida de token -> id
  const tokenToIdMap = new Map(allTokens.map((t: any) => [t.token, t.id]));

  console.log(`Enviando notificações para ${allTokens.length} token(s)...`);

  const messages: ExpoPushMessage[] = [];
  for (const tokenRecord of allTokens) {
    messages.push({
      to: tokenRecord.token,
      sound: "default",
      title: title,
      body: excerpt || "Novo Conteúdo",
      data: { postId: id },
    });
  }

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log("Tickets recebidos da Expo:", tickets);

      // Loop otimizado e seguro para salvar tickets
      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        // Pegamos a mensagem original para saber a qual token este ticket se refere
        const originalMessage = chunk[i];

        if (ticket.status === "ok") {
          const tokenDbId = tokenToIdMap.get(originalMessage.to as string);
          if (tokenDbId) {
            await prisma.notificationTicket.create({
              data: {
                expoTicketId: ticket.id,
                pushTokenId: tokenDbId,
              },
            });
          }
        }
      }
    } catch (error) {
      console.error("Erro ao enviar chunk ou salvar tickets:", error);
    }
  }
}

// --- Iniciar o Servidor ---
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor De Notificações rodando na porta ${PORT}`);
});
