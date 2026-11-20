import { iniciarWorker } from './relatorio.worker.js';
import { iniciarWorkerAnalytics } from './analytics.worker.js';
import { agendarRecalculoDiario, fecharFilaAnalytics } from './analytics.queue.js';

// Sobe os dois workers (relatórios dos parceiros e recálculo das análises) e registra o agendamento.
export async function iniciarProcessamento() {
  const workerRelatorios = iniciarWorker();
  const workerAnalytics = iniciarWorkerAnalytics();

  if (process.env.ENABLE_SCHEDULER !== 'false') {
    try {
      const { pattern, tz } = await agendarRecalculoDiario();
      console.log(`⏰ Recálculo das análises agendado: "${pattern}" (${tz}).`);
    } catch (err) {
      // Sem Redis o servidor sobe mesmo assim; o agendamento é registrado na próxima inicialização.
      console.error('[agendador] não foi possível registrar o agendamento (Redis indisponível?):', err);
    }
  }

  return {
    async close() {
      await Promise.all([workerRelatorios.close(), workerAnalytics.close()]);
      await fecharFilaAnalytics();
    },
  };
}