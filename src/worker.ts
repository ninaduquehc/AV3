import 'dotenv/config';
import { iniciarProcessamento } from './queue/index.js';
import { fecharFila } from './queue/relatorio.queue.js';
import { prisma } from './lib/prisma.js';

// Processo dedicado aos workers e ao agendador (uso: npm run worker, com ENABLE_WORKER=false na API).
const processamento = await iniciarProcessamento();
console.log('👷 Workers de relatórios e análises iniciados (processo dedicado).');

const encerrar = async (sinal: string) => {
  console.log(`\n⚠️ Sinal ${sinal} recebido. Aguardando tarefas em andamento...`);
  try {
    await processamento.close();
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