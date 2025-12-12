import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

// Lógica inteligente de conexão:
// Se tiver REDIS_URL (Render/Upstash), usa ela.
// Se não, tenta usar HOST e PORT separados (Docker local).

const getRedisConnection = () => {
  let redis: IORedis;

  if (process.env.REDIS_URL) {
    try {
      const url = new URL(process.env.REDIS_URL);
      console.log("[Redis] Conectando via URL segura...");

      redis = new IORedis({
        host: url.hostname,
        port: Number(url.port),
        username: url.username,
        password: url.password,
        // Configurações Vitais para Upstash:
        tls: {
          rejectUnauthorized: false, // Aceita o certificado do Upstash
        },
        enableReadyCheck: false, // <--- OBRIGA a pular o comando INFO
        maxRetriesPerRequest: null, // Obrigatório para BullMQ
        family: 0, // Resolve problemas de IPv4/IPv6 no Node 18+
      });
    } catch (e) {
      console.error("Erro URL Redis:", e);
      throw e;
    }
  } else {
    // Conexão Local (Docker)
    redis = new IORedis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    });
  }

  return redis;
};
// Criamos a fila chamada 'notifications'
export const connection = getRedisConnection();

export const notificationQueue = new Queue("notifications", {
  connection,
  defaultJobOptions: {
    removeOnComplete: true, // Remove jobs completos para não encher a memória do Redis
    removeOnFail: 100, // Mantém os últimos 100 erros para debug
    attempts: 3, // Tenta 3 vezes se falhar o envio
  },
  // --- MODO ECONÔMICO: Desativa métricas desnecessárias ---
  skipMetasUpdate: true,
});
