import { hmacSha256 } from './crypto.js';
import { assertPublicUrl } from './media.js';

export const WEBHOOK_EVENTS = ['post.published', 'post.failed', 'account.expired'];

// Registro de atividade (tela Histórico) + disparo de webhooks do usuário.
export function createEvents({ db, fetch, now = Date.now, logger = console, allowPrivateUrls = false }) {
  const pending = new Set();

  function log(userId, { level = 'info', event, message, postId = null, accountId = null }) {
    db.run(
      'INSERT INTO logs (user_id, post_id, account_id, level, event, message, created_at) VALUES (?,?,?,?,?,?,?)',
      userId,
      postId,
      accountId,
      level,
      event,
      message,
      now(),
    );
  }

  async function deliver(hook, event, data) {
    const body = JSON.stringify({ event, created_at: new Date(now()).toISOString(), data });
    let status = null;
    let error = null;
    try {
      // Webhook não pode apontar para a rede interna do servidor (SSRF).
      if (!allowPrivateUrls) await assertPublicUrl(hook.url);
      const res = await fetch(hook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'FlyPost-Webhooks/1',
          'X-FlyPost-Event': event,
          'X-FlyPost-Signature': `sha256=${hmacSha256(hook.secret, body)}`,
        },
        body,
        redirect: 'manual', // redirecionamento poderia levar para a rede interna
        signal: AbortSignal.timeout(8000),
      });
      status = res.status;
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (err) {
      error = err.name === 'TimeoutError' ? 'Tempo esgotado (8s)' : err.message;
      if (err.status === 400) error = `Endereço recusado: ${err.message}`;
    }
    db.run('UPDATE webhooks SET last_status = ?, last_error = ?, last_delivery_at = ? WHERE id = ?', status, error, now(), hook.id);
    return { status, error };
  }

  function emit(userId, event, data) {
    const hooks = db.all('SELECT * FROM webhooks WHERE user_id = ? AND active = 1', userId).filter((h) => JSON.parse(h.events).includes(event));
    for (const hook of hooks) {
      const p = deliver(hook, event, data)
        .catch((err) => logger.error('[webhook]', err))
        .finally(() => pending.delete(p));
      pending.add(p);
    }
  }

  return { log, emit, deliver, settle: () => Promise.all([...pending]) };
}
