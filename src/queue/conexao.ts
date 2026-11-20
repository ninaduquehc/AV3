import type { ConnectionOptions } from 'bullmq';

function opcoesBase() {
  const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6380');
  return {
    host: url.hostname,
    port: Number(url.port) || 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
    tls: url.protocol === 'rediss:' ? {} : undefined,
  };
}

// API: se o Redis estiver fora do ar, o comando falha rápido (a rota responde 503).
export function conexaoFila(): ConnectionOptions {
  return {
    ...opcoesBase(),
    maxRetriesPerRequest: 1,
    retryStrategy: (tentativa: number) => Math.min(tentativa * 200, 2000),
  };
}

// Worker: precisa esperar o Redis voltar indefinidamente (exigência do BullMQ).
export function conexaoWorker(): ConnectionOptions {
  return { ...opcoesBase(), maxRetriesPerRequest: null };
}