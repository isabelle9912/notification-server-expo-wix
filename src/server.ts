import "dotenv/config"; // ESSA DEVE SER A PRIMEIRA LINHA DO ARQUIVO
import express, { Request, Response, Application } from "express";
import { Expo } from "expo-server-sdk";
import bodyParser from "body-parser";
import { prisma } from "./lib/prisma"; // Importamos a instância do Prisma
import { notificationQueue } from "./lib/queue";

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
 * Rota para deletar um token existente do banco de dados
 */
app.delete("/unregister:token", async (req: Request, res: Response) => {
  try {
    // 1. Pega o token da URL (ex: /unregister/ExponentPushToken[xxxx])
    const { token } = req.params;

    if (!token) {
      return res.status(400).json({ error: "Token é obrigatório." });
    }

    console.log(`Tentando remover token: ${token}`);

    // 2. Deleta usando o Prisma
    // Usamos deleteMany para evitar erro caso o token não exista (idempotência)
    // Se usássemos .delete(), teríamos que tratar o erro P2025 (Record not found)
    const deleted = await prisma.pushToken.deleteMany({
      where: {
        token: token,
      },
    });

    if (deleted.count > 0) {
      console.log(`Sucesso: Token ${token} e seus tickets foram removidos.`);
      return res.status(200).json({ message: "Token removido com sucesso." });
    } else {
      console.log(`Aviso: Token ${token} não foi encontrado no banco.`);
      // Retornamos 200 mesmo assim, pois o objetivo (não ter o token) foi cumprido
      return res.status(200).json({ message: "Token já não existia." });
    }
  } catch (error) {
    console.error("Erro crítico ao remover token:", error);
    return res.status(500).json({ error: "Erro interno ao remover token." });
  }
});

/**
 * Rota que receberá o webhook do Wix.
 */
app.post(
  "/wix-webhook",
  async (req: Request<{}, {}, WixWebhookPayload>, res: Response) => {
    console.log("Webhook do Wix recebido:", req.body);
    const { title, id, excerpt } = req.body.data;

    if (!title || !id) {
      return res.status(400).send({ error: "Dados incompletos." });
    }

    try {
      // ADICIONA NA FILA e responde imediatamente
      await notificationQueue.add("send-notification", {
        title,
        postId: id,
        excerpt,
      });

      console.log(`Job adicionado na fila para o post ${id}`);
      // O Wix recebe 200 OK instantaneamente
      res.status(200).send("Processamento iniciado em segundo plano.");
    } catch (error) {
      console.error("Erro ao adicionar na fila:", error);
      res.status(500).send("Erro interno.");
    }
  }
);

// --- Iniciar o Servidor ---
const PORT: number = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor De Notificações rodando na porta ${PORT}`);
});
