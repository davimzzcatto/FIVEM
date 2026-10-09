import http from 'node:http';
import { createApp } from './app.js';

const app = createApp();
const { config } = app;
const server = http.createServer(app.handler);
// Uploads grandes em conexão lenta passam do padrão de 5 minutos do Node.
server.requestTimeout = 30 * 60_000;

server.listen(config.port, () => {
  console.log(`FlyPost rodando em ${config.publicUrl} (porta ${config.port})`);
  const off = Object.entries(config.integrations).filter(([, on]) => !on).map(([k]) => k);
  if (off.length) console.log(`Integrações sem credencial (só contas de teste): ${off.join(', ')}`);
  if (!config.publicUrl.startsWith('https://')) console.log('PUBLIC_URL não é HTTPS: as redes sociais não vão conseguir baixar as mídias. Use um túnel ou domínio em produção.');
  app.scheduler.start();
});

let closing = false;
async function shutdown(signal) {
  if (closing) return;
  closing = true;
  console.log(`${signal}: encerrando (esperando publicações em andamento)...`);
  server.close();
  await app.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
