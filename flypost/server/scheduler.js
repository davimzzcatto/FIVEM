import { PublishError } from './publishers/errors.js';
import { TYPES, PLATFORMS } from '../public/lib/rules.js';

const BACKOFF = [60_000, 5 * 60_000, 15 * 60_000];
const STALE_MS = 30 * 60_000;
const GRACE_INACTIVE_MS = 60 * 60_000;
const MAINTENANCE_EVERY = 60 * 60_000;

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fila de publicação: a cada ciclo pega os posts vencidos e publica, com novas tentativas.
export function createScheduler({ db, config, publishers, accounts, media, events, fetch, now = Date.now, sleep = realSleep, logger = console }) {
  const inflight = new Map(); // id do post → promessa da publicação em andamento
  let timer = null;
  let ticking = false;
  let lastMaintenance = 0;

  function claim(n) {
    const t = now();
    return db.tx(() => {
      const rows = db.all(
        `SELECT p.id FROM posts p JOIN accounts a ON a.id = p.account_id
         WHERE p.status = 'scheduled' AND p.scheduled_at <= ? AND (p.next_attempt_at IS NULL OR p.next_attempt_at <= ?)
           AND a.status = 'active'
         ORDER BY p.scheduled_at LIMIT ?`,
        t,
        t,
        n,
      );
      for (const r of rows) db.run("UPDATE posts SET status = 'publishing', locked_at = ?, updated_at = ? WHERE id = ?", t, t, r.id);
      return rows.map((r) => r.id);
    });
  }

  function label(post, acc) {
    return `${TYPES[post.type]?.label || post.type} em @${acc.username} (${PLATFORMS[acc.platform]?.label || acc.platform})`;
  }

  function payload(post, acc, extra = {}) {
    return { post_id: post.id, account_id: acc.id, platform: acc.platform, username: acc.username, type: post.type, scheduled_at: post.scheduled_at, ...extra };
  }

  async function run(id) {
    const post = db.get('SELECT * FROM posts WHERE id = ?', id);
    if (!post) return;
    post.options = JSON.parse(post.options_json || '{}');
    let acc = accounts.load(post.account_id);
    const ctx = {
      fetch,
      sleep,
      now,
      publicUrl: media.publicUrl,
      filePath: media.filePath,
      info: (message) => events.log(post.user_id, { level: 'info', event: 'post.note', postId: post.id, accountId: acc.id, message }),
      warn: (message) => events.log(post.user_id, { level: 'warn', event: 'post.warning', postId: post.id, accountId: acc.id, message }),
    };

    try {
      acc = await accounts.ensureFresh(acc);
      const ids = JSON.parse(post.media_ids);
      const files = media.byIds(post.user_id, ids);
      if (files.length !== ids.length) throw new PublishError('Uma das mídias do post não existe mais.');
      if (post.options.cover_media_id) post.options.cover = media.byIds(post.user_id, [post.options.cover_media_id])[0] || null;

      const result = await publishers.for(acc).publish({ post, account: acc, media: files, ctx });
      const t = now();
      db.run(
        `UPDATE posts SET status = 'published', remote_id = ?, permalink = ?, published_at = ?, attempts = attempts + 1,
           last_error = NULL, locked_at = NULL, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
        result.remoteId,
        result.permalink,
        t,
        t,
        post.id,
      );
      events.log(post.user_id, { level: 'success', event: 'post.published', postId: post.id, accountId: acc.id, message: `Publicado: ${label(post, acc)}.` });
      events.emit(post.user_id, 'post.published', payload(post, acc, { remote_id: result.remoteId, permalink: result.permalink, published_at: t }));
    } catch (err) {
      const attempts = post.attempts + 1;
      const message = err instanceof PublishError ? err.message : `Erro inesperado: ${err.message}`;
      if (!(err instanceof PublishError)) logger.error('[agendador]', err);
      if (err.auth) accounts.markExpired(acc, message);
      const t = now();

      if (err.retryable && attempts < config.scheduler.maxAttempts) {
        const wait = BACKOFF[Math.min(attempts - 1, BACKOFF.length - 1)];
        db.run(
          "UPDATE posts SET status = 'scheduled', attempts = ?, next_attempt_at = ?, last_error = ?, locked_at = NULL, updated_at = ? WHERE id = ?",
          attempts,
          t + wait,
          message,
          t,
          post.id,
        );
        events.log(post.user_id, {
          level: 'warn',
          event: 'post.retry',
          postId: post.id,
          accountId: acc.id,
          message: `Tentativa ${attempts} falhou (${label(post, acc)}): ${message} Nova tentativa em ${Math.round(wait / 60_000)} min.`,
        });
        return;
      }
      db.run("UPDATE posts SET status = 'failed', attempts = ?, last_error = ?, locked_at = NULL, updated_at = ? WHERE id = ?", attempts, message, t, post.id);
      events.log(post.user_id, { level: 'error', event: 'post.failed', postId: post.id, accountId: acc.id, message: `Falhou: ${label(post, acc)}. ${message}` });
      events.emit(post.user_id, 'post.failed', payload(post, acc, { error: message, attempts }));
    }
  }

  function failMany(rows, reason) {
    const t = now();
    for (const p of rows) {
      db.run("UPDATE posts SET status = 'failed', last_error = ?, locked_at = NULL, updated_at = ? WHERE id = ?", reason(p), t, p.id);
      events.log(p.user_id, { level: 'error', event: 'post.failed', postId: p.id, accountId: p.account_id, message: reason(p) });
      events.emit(p.user_id, 'post.failed', { post_id: p.id, account_id: p.account_id, error: reason(p) });
    }
  }

  // Posts que ficaram "publicando" porque o processo caiu no meio: não dá para saber se saíram.
  function recoverStale(olderThan) {
    const rows = db.all("SELECT id, user_id, account_id FROM posts WHERE status = 'publishing' AND locked_at < ?", olderThan).filter((p) => !inflight.has(p.id));
    failMany(rows, () => 'A publicação foi interrompida no meio. Confira o perfil antes de tentar de novo.');
  }

  // Conta desativada ou expirada segura os posts por 1h (dá tempo de reconectar); depois, falha.
  function sweepInactive() {
    const rows = db.all(
      `SELECT p.id, p.user_id, p.account_id, a.status AS account_status FROM posts p JOIN accounts a ON a.id = p.account_id
       WHERE p.status = 'scheduled' AND p.scheduled_at < ? AND a.status != 'active'`,
      now() - GRACE_INACTIVE_MS,
    );
    failMany(rows, (p) => (p.account_status === 'disabled' ? 'A conta estava desativada no horário do post.' : 'A conta precisava ser reconectada no horário do post.'));
  }

  async function maintenance() {
    lastMaintenance = now();
    const t = now();
    db.run('DELETE FROM sessions WHERE expires_at < ?', t);
    db.run('DELETE FROM oauth_states WHERE created_at < ?', t - 60 * 60_000);
    db.run('DELETE FROM logs WHERE created_at < ?', t - 180 * 86_400_000);
    media.collectGarbage();
    await accounts.refreshAll();
  }

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      sweepInactive();
      recoverStale(now() - STALE_MS);
      if (now() - lastMaintenance > MAINTENANCE_EVERY) {
        maintenance().catch((err) => logger.error('[manutenção]', err));
      }
      const room = config.scheduler.concurrency - inflight.size;
      if (room <= 0) return;
      for (const id of claim(room)) {
        const p = run(id)
          .catch((err) => logger.error('[agendador]', err))
          .finally(() => inflight.delete(id));
        inflight.set(id, p);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    tick,
    run,
    start() {
      // No boot, tudo que estava "publicando" foi interrompido pelo desligamento.
      recoverStale(Number.MAX_SAFE_INTEGER);
      timer = setInterval(() => tick().catch((err) => logger.error('[agendador]', err)), config.scheduler.intervalMs);
      timer.unref?.();
      tick().catch((err) => logger.error('[agendador]', err));
    },
    async stop() {
      clearInterval(timer);
      await Promise.all([...inflight.values()]);
    },
    nudge() {
      setImmediate(() => tick().catch((err) => logger.error('[agendador]', err)));
    },
    idle: () => Promise.all([...inflight.values()]),
  };
}
