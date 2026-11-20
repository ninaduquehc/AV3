import { Queue } from 'bullmq';
import { conexaoFila } from './conexao.js';

// Em teste usa outra fila, para não competir com um servidor de desenvolvimento aberto.
export const NOME_FILA_ANALYTICS = process.env.NODE_ENV === 'test' ? 'analytics-test' : 'analytics';

// Identificador fixo: registrar o agendamento várias vezes (reinícios, várias instâncias) não duplica a execução.
export const ID_AGENDADOR = 'recalculo-diario';

let fila: Queue | null = null;

export function obterFilaAnalytics(): Queue {
  if (!fila) {
    fila = new Queue(NOME_FILA_ANALYTICS, { connection: conexaoFila() });
    fila.on('error', (err) => console.error('[analytics] erro de conexão com o Redis:', err.message));
  }
  return fila;
}

// Lida a cada chamada, para poder ser ajustada por variável de ambiente.
export function configuracaoAgendamento() {
  return {
    pattern: process.env.ANALYTICS_CRON || '0 2 * * *', // todo dia às 02:00
    tz: process.env.ANALYTICS_TZ || 'America/Sao_Paulo',
  };
}

export async function agendarRecalculoDiario() {
  const { pattern, tz } = configuracaoAgendamento();

  await obterFilaAnalytics().upsertJobScheduler(
    ID_AGENDADOR,
    { pattern, tz },
    {
      name: 'recalcular-analises',
      data: {},
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 }, // 5s, 10s
        removeOnComplete: { count: 30 },
        removeOnFail: { age: 30 * 24 * 3600 },
      },
    }
  );

  return { pattern, tz };
}

export async function fecharFilaAnalytics() {
  if (fila) {
    const atual = fila;
    fila = null;
    await atual.close();
  }
}