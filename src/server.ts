import 'dotenv/config';
import { buildApp } from './app.js';
import { iniciarProcessamento } from './queue/index.js';

const app = await buildApp();
const port = Number(process.env.PORT) || 3000;

// Workers e agendador rodam no mesmo processo por padrão.
// Use ENABLE_WORKER=false para rodá-los à parte (npm run worker).
const processamento = process.env.ENABLE_WORKER === 'false' ? null : await iniciarProcessamento();

try {
  await app.listen({ port, host: '0.0.0.0' });
  console.log(`🚀 Servidor rodando em http://localhost:${port}`);
  console.log(`📖 Swagger interno: http://localhost:${port}/docs/internal`);
  console.log(`🌐 Swagger público: http://localhost:${port}/docs/public`);
  console.log(
    processamento
      ? '👷 Workers (relatórios e análises) ativos neste processo.'
      : '👷 Workers desativados neste processo (ENABLE_WORKER=false).'
  );
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// Handler para Graceful Shutdown
const closeGracefully = async (signal: string) => {
  console.log(`\n⚠️ Sinal ${signal} recebido. Encerrando servidor graciosamente...`);
  try {
    await processamento?.close(); // aguarda as tarefas em andamento terminarem
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