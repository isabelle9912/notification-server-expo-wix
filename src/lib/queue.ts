import { Queue } from "bullmq";
import IORedis from "ioredis";

// Lógica inteligente de conexão:
// Se tiver REDIS_URL (Render/Upstash), usa ela.
// Se não, tenta usar HOST e PORT separados (Docker local).
const connection = process.env.REDIS_URL
  ? new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })
  : new IORedis({
      host: process.env.REDIS_HOST || "localhost",
      port: parseInt(process.env.REDIS_PORT || "6379"),
      maxRetriesPerRequest: null,
    });

// Criamos a fila chamada 'notifications'
export const notificationQueue = new Queue("notifications", { connection });
export { connection };
