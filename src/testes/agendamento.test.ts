import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Worker } from 'bullmq';
import { OrigemAnalise } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import {
  ID_AGENDADOR,
  agendarRecalculoDiario,
  fecharFilaAnalytics,
  obterFilaAnalytics,
} from '../queue/analytics.queue.js';
import { iniciarWorkerAnalytics } from '../queue/analytics.worker.js';

describe('Agendamento das análises (job recorrente BullMQ)', () => {
  let worker: Worker;

  beforeAll(async () => {
    delete process.env.ANALYTICS_CRON;
    delete process.env.ANALYTICS_TZ;
    worker = iniciarWorkerAnalytics();
    await worker.waitUntilReady();
  });

  afterAll(async () => {
    await obterFilaAnalytics().removeJobScheduler(ID_AGENDADOR);
    await worker.close();
    await fecharFilaAnalytics();
    await prisma.$disconnect();
  });

  it('registra o agendamento diário e é idempotente (registrar de novo não duplica)', async () => {
    const config = await agendarRecalculoDiario();
    await agendarRecalculoDiario();

    expect(config).toEqual({ pattern: '0 2 * * *', tz: 'America/Sao_Paulo' });

    const agendadores = await obterFilaAnalytics().getJobSchedulers();
    expect(agendadores).toHaveLength(1);
    expect(agendadores[0].pattern).toBe('0 2 * * *');
    expect(agendadores[0].next).toBeGreaterThan(Date.now());
  });

  it(
    'o worker executa o recálculo e grava os 3 snapshots com origem AGENDADO',
    async () => {
      const antes = await prisma.relatorioAnalitico.count({ where: { origem: OrigemAnalise.AGENDADO } });

      await obterFilaAnalytics().add('recalcular-analises', {});

      const inicio = Date.now();
      for (;;) {
        const agora = await prisma.relatorioAnalitico.count({ where: { origem: OrigemAnalise.AGENDADO } });
        if (agora >= antes + 3) break;
        if (Date.now() - inicio > 15000) throw new Error('Tempo esgotado aguardando o recálculo agendado.');
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const ultimos = await prisma.relatorioAnalitico.findMany({
        where: { origem: OrigemAnalise.AGENDADO },
        orderBy: { geradoEm: 'desc' },
        take: 3,
        select: { categoria: true },
      });
      expect(ultimos.map((r) => r.categoria).sort()).toEqual([
        'EFICIENCIA_OPERACIONAL',
        'RENTABILIDADE',
        'VIDA_UTIL',
      ]);
    },
    20000
  );
});