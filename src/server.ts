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

interface NotificationActionPayload {
  postId?: string;
  url?: string;
}

interface NotificationAction {
  type: "navigatePost" | "navigateDeepLink" | "none";
  payload?: NotificationActionPayload;
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

app.post(
  "/wix-webhook",
  (req: Request<{}, {}, WixWebhookPayload>, res: Response) => {
    console.log("Webhook do Wix recebido:", req.body);
    const { title, id, excerpt } = req.body.data;

    if (!title || !id) {
      return res
        .status(400)
        .send({ error: "Título e ID do post são obrigatórios." });
    }

    // Monta a ação para a notificação de novo post
    const action: NotificationAction = {
      type: "navigatePost",
      payload: { postId: id },
    };

    sendMassNotifications(title, excerpt || "Novo Conteúdo", action);
    res.status(200).send("Webhook processado.");
  }
);

app.post("/send-proposal-notification", async (req, res) => {
  // ATENÇÃO: Lembre-se de reativar esta segurança para produção!
  // const internalSecret = req.header("X-Internal-Secret");
  // if (internalSecret !== process.env.INTERNAL_SECRET_KEY) {
  //   return res.status(401).send({ error: "Acesso não autorizado." });
  // }

  const { token, step } = req.body;
  if (!token || !step) {
    return res.status(400).send({ error: 'Token e "step" são obrigatórios.' });
  }

  let title = "";
  let body = "";
  let action: NotificationAction = { type: "none" };

  switch (step) {
    // ... (lógica do switch continua a mesma)
    case 1:
      title = "Uma notificação especial...";
      body = "Para a autora da minha história preferida...";
      action = { type: "none" };
      break;
    case 2:
      title = "Recordações";
      body =
        "Quinze anos de amor, risadas e parceria. Cada momento nos trouxe até aqui.";
      action = { type: "none" };
      break;
    case 3:
      title = "Nosso Próximo Capítulo";
      body = "Este não está escrito em nenhum post. Abra para descobrir.";
      action = {
        type: "navigateDeepLink",
        payload: { url: "tessareis://proposal" },
      };
      break;
    default:
      return res.status(400).send({ error: "Passo (step) inválido." });
  }

  // Monta a mensagem no formato correto
  const message: ExpoPushMessage = {
    to: token,
    sound: "default",
    title,
    body,
    data: { action },
  };

  // ✅ MUDANÇA PRINCIPAL: Usamos a função central que salva os tickets
  await sendAndTrackNotifications([message]);

  res.status(200).send({ message: `Notificação do passo ${step} enviada.` });
});

// --- Lógica de Envio de Notificações REATORADA ---

/**
 * Monta e envia notificações para TODOS os usuários.
 */
async function sendMassNotifications(
  title: string,
  body: string,
  action: NotificationAction
): Promise<void> {
  console.log("Buscando todos os tokens do banco de dados...");
  const allTokens = await prisma.pushToken.findMany();

  if (allTokens.length === 0) {
    console.log("Nenhum token registrado.");
    return;
  }

  console.log(`Montando notificações para ${allTokens.length} token(s)...`);

  const messages: ExpoPushMessage[] = allTokens.map((tokenRecord) => ({
    to: tokenRecord.token,
    sound: "default",
    title: title,
    body: body,
    data: { action },
  }));

  // Usa a função centralizada que salva os tickets
  await sendAndTrackNotifications(messages);
}

/**
 * ✨ FUNÇÃO CENTRAL E ÚNICA PARA ENVIO E RASTREAMENTO ✨
 * Recebe um array de mensagens, envia para a Expo e salva os tickets no banco.
 */
async function sendAndTrackNotifications(
  messages: ExpoPushMessage[]
): Promise<void> {
  // Busca os IDs dos tokens para salvar os tickets
  const allTokenRecords = await prisma.pushToken.findMany();
  const tokenToIdMap = new Map(allTokenRecords.map((t) => [t.token, t.id]));

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      const tickets = await expo.sendPushNotificationsAsync(chunk);
      console.log("Tickets recebidos da Expo:", tickets);

      for (let i = 0; i < tickets.length; i++) {
        const ticket = tickets[i];
        const originalMessage = chunk[i];

        if (ticket.status === "ok") {
          const tokenDbId = tokenToIdMap.get(originalMessage.to as string);
          if (tokenDbId) {
            // AQUI ESTÁ A LÓGICA DE SALVAR O TICKET
            await prisma.notificationTicket.create({
              data: {
                expoTicketId: ticket.id,
                pushTokenId: tokenDbId,
              },
            });
          }
        } else {
          // Opcional: Logar erros que já vêm no ticket
          console.error(
            `Erro no ticket para o token ${originalMessage.to}: ${ticket.message}`
          );
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
