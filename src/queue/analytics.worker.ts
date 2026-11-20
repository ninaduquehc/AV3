import { Worker } from 'bullmq';
import { OrigemAnalise } from '@prisma/client';
import { NOME_FILA_ANALYTICS } from './analytics.queue.js';
import { conexaoWorker } from './conexao.js';
import { AnalyticsService } from '../services/analytics/analytics.service.js';

export function iniciarWorkerAnalytics() {
  const service = new AnalyticsService();

  const worker = new Worker(
    NOME_FILA_ANALYTICS,
    async () => {
      // Snapshots são históricos (só se acrescenta): um retry nunca sobrescreve nada.
      const salvos = await service.recalcular(undefined, OrigemAnalise.AGENDADO);
      console.log(`[analytics] recálculo agendado concluído (${salvos.length} relatórios gravados).`);
      return { relatorios: salvos.length };
    },
    { connection: conexaoWorker(), concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    const maximo = job?.opts.attempts ?? 1;
    const tentativa = job?.attemptsMade ?? 0;
    console.error(
      `[analytics] recálculo falhou (tentativa ${tentativa}/${maximo}${tentativa >= maximo ? ', definitiva' : ', nova tentativa agendada'}): ${err.message}`
    );
  });

  worker.on('error', (err) => console.error('[analytics] erro no worker:', err.message));

  return worker;
}