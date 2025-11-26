import "dotenv/config";
import { Queue } from "bullmq";
import IORedis from "ioredis";

// Lógica inteligente de conexão:
// Se tiver REDIS_URL (Render/Upstash), usa ela.
// Se não, tenta usar HOST e PORT separados (Docker local).

const getRedisConnection = () => {
  if (process.env.REDIS_URL) {
    // Conexão de Produção (Upstash/Render)
    return new IORedis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      // Esta opção é vital para conexões 'rediss://' (TLS)
      tls: {
        rejectUnauthorized: false,
      },
    });
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
export const notificationQueue = new Queue("notifications", { connection });
