import { randomToken } from '../crypto.js';
import { PublishError } from './errors.js';

// Contas simuladas: percorrem o fluxo inteiro (fila, tentativas, histórico, webhooks)
// sem chamar nenhuma rede social. Para testar falhas, escreva na legenda:
//   [falhar]   → falha definitiva
//   [instavel] → falha na primeira tentativa e publica na seguinte
export function createSimulatorPublisher({ config, random = Math.random }) {
  async function publish({ post, account, ctx }) {
    await ctx.sleep(post.type === 'reels' ? 1200 : 400);
    if (post.caption.includes('[falhar]')) throw new PublishError('Falha simulada (a legenda contém [falhar]).');
    if (post.caption.includes('[instavel]') && post.attempts === 0) {
      throw new PublishError('Instabilidade simulada (a legenda contém [instavel]).', { retryable: true });
    }
    if (config.simFailRate > 0 && random() < config.simFailRate) {
      throw new PublishError('Falha simulada aleatória (SIM_FAIL_RATE).', { retryable: true });
    }
    if (post.first_comment) ctx.info(`Primeiro comentário simulado em @${account.username}.`);
    return { remoteId: `sim_${randomToken(9)}`, permalink: null };
  }
  return { publish };
}
