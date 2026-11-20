import 'dotenv/config';
import { buildApp } from './app.js';
import { iniciarWorker } from './queue/relatorio.worker.js';

const app = await buildApp();
const port = Number(process.env.PORT) || 3000;

// O worker roda no mesmo processo por padrão. Use ENABLE_WORKER=false para rodá-lo à parte (npm run worker).
const worker = process.env.ENABLE_WORKER === 'false' ? null : iniciarWorker();

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`📖 Swagger interno: http://localhost:${port}/docs/internal`);
  console.log(`🌐 Swagger público: http://localhost:${port}/docs/public`);
  console.log(worker ? '👷 Worker de relatórios ativo neste processo.' : '👷 Worker desativado neste processo (ENABLE_WORKER=false).');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Handler para Graceful Shutdown
const closeGracefully = async (signal: string) => {
  console.log(`\n⚠️ Sinal ${signal} recebido. Encerrando servidor graciosamente...`);
  try {
    await worker?.close(); // aguarda a tarefa em andamento terminar
    await app.close();
    console.log('✅ Conexões e servidor encerrados com sucesso.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Erro ao encerrar o servidor:', err);
    process.exit(1);
  }
};

process.on('SIGINT', () => closeGracefully('SIGINT'));
process.on('SIGTERM', () => closeGracefully('SIGTERM'));