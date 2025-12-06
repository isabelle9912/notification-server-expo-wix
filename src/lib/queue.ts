import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

// Lógica inteligente de conexão:
// Se tiver REDIS_URL (Render/Upstash), usa ela.
// Se não, tenta usar HOST e PORT separados (Docker local).

const getRedisConnection = () => {
  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);

      console.log("🔗 Conectando ao Redis via URL parseada...");

      return new IORedis({
        host: url.hostname,
        port: Number(url.port),
        username: url.username, // Upstash usa 'default' geralmente
        password: url.password,

        // Configurações Vitais para Upstash:
        tls: {
          rejectUnauthorized: false, // Aceita o certificado do Upstash
        },
        maxRetriesPerRequest: null, // Obrigatório para BullMQ
        enableReadyCheck: false, // <--- OBRIGA a pular o comando INFO
        family: 0, // Resolve problemas de IPv4/IPv6 no Node 18+
      });
    } catch (e) {
      console.error("Erro ao fazer parse da URL do Redis:", e);
      throw e;
    }
  }

  // Conexão Local (Docker)
  return new IORedis({
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    maxRetriesPerRequest: null,
  });
};
// Criamos a fila chamada 'notifications'
export const connection = getRedisConnection();
export const notificationQueue = new Queue("notifications", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true, // Remove jobs completos para não encher a memória do Redis
    removeOnFail: 500, // Mantém os últimos 500 erros para debug
    attempts: 3, // Tenta 3 vezes se falhar o envio
    backoff: {
      type: "exponential",
      delay: 1000,
    },
  },
});
