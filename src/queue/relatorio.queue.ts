import { Queue, JobsOptions } from 'bullmq';
import { conexaoFila } from './conexao.js';

// Em teste usa outra fila, para não competir com um servidor de desenvolvimento aberto.
export const NOME_FILA = process.env.NODE_ENV === 'test' ? 'relatorios-test' : 'relatorios';

let fila: Queue | null = null;

export function obterFila(): Queue {
  if (!fila) {
    fila = new Queue(NOME_FILA, { connection: conexaoFila() });
    fila.on('error', (err) => console.error('[fila] erro de conexão com o Redis:', err.message));
  }
  return fila;
}

// Política de retry. Lida a cada enfileiramento, para poder ser ajustada por env.
export function opcoesDoJob(): JobsOptions {
  const tentativas = Number(process.env.RELATORIO_TENTATIVAS) || 3;
  const atrasoMs = Number(process.env.RELATORIO_BACKOFF_MS) || 2000;

  return {
    attempts: tentativas,
    backoff: { type: 'exponential', delay: atrasoMs }, // 2s, 4s, 8s...
    removeOnComplete: { age: 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600 },
  };
}

// O jobId do BullMQ é o próprio id do RelatorioJob: enfileirar duas vezes não duplica.
export async function enfileirarRelatorio(relatorioJobId: string) {
  await obterFila().add('gerar-relatorio', { relatorioJobId }, { ...opcoesDoJob(), jobId: relatorioJobId });
}

export async function fecharFila() {
  if (fila) {
    const atual = fila;
    fila = null;
    await atual.close();
  }
}