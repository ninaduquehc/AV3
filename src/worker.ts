import 'dotenv/config';
import { iniciarWorker } from './queue/relatorio.worker.js';
import { fecharFila } from './queue/relatorio.queue.js';
import { prisma } from './lib/prisma.js';

// Processo dedicado ao worker (uso: npm run worker, com ENABLE_WORKER=false no servidor da API).
const worker = iniciarWorker();
console.log('👷 Worker de relatórios iniciado (processo dedicado).');

const encerrar = async (sinal: string) => {
  console.log(`\n⚠️ Sinal ${sinal} recebido. Aguardando tarefas em andamento...`);
  try {
    await worker.close();
    await fecharFila();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro ao encerrar o worker:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => encerrar('SIGINT'));
process.on('SIGTERM', () => encerrar('SIGTERM'));