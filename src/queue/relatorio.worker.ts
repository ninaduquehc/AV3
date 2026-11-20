import { Worker } from 'bullmq';
import { NOME_FILA } from './relatorio.queue.js';
import { conexaoWorker } from './conexao.js';
import { RelatorioService } from '../services/relatorio.service.js';

export function iniciarWorker() {
  const service = new RelatorioService();

  const worker = new Worker<{ relatorioJobId: string }>(
    NOME_FILA,
    // attemptsMade = tentativas que já falharam; esta é a seguinte.
    async (job) => service.processar(job.data.relatorioJobId, job.attemptsMade + 1),
    { connection: conexaoWorker(), concurrency: Number(process.env.WORKER_CONCURRENCY) || 2 }
  );

  // Dispara a cada tentativa que falha (inclusive as que ainda serão repetidas).
  worker.on('failed', (job, err) => {
    if (!job) return;
    const maximo = job.opts.attempts ?? 1;
    const definitiva = job.attemptsMade >= maximo;

    console.error(
      `[worker] relatório ${job.data.relatorioJobId} falhou ` +
        `(tentativa ${job.attemptsMade}/${maximo}${definitiva ? ', definitiva' : ', nova tentativa agendada'}): ${err.message}`
    );

    service
      .registrarFalha(job.data.relatorioJobId, definitiva, err)
      .catch((e) => console.error('[worker] não foi possível registrar a falha:', e));
  });

  worker.on('error', (err) => console.error('[worker] erro:', err.message));

  return worker;
}