import { badRequest, notFound } from '../http.js';

export function registerPostRoutes(router, { db, media, posts, scheduler }) {
  // ---- Mídia ----
  // Upload cru: PUT /api/media?name=foto.jpg com o arquivo no corpo (sem multipart).
  router.add(
    'PUT',
    '/api/media',
    async ({ req, user, query }) =>
      media.store(user.id, req, {
        mime: String(req.headers['content-type'] || '').split(';')[0].trim(),
        originalName: query.name,
        hint: { width: query.width, height: query.height, duration_ms: query.duration_ms },
      }),
    { raw: true, status: 201 },
  );

  router.add('POST', '/api/media/from-url', async ({ user, body }) => {
    if (!body.url) throw badRequest('Informe a URL da mídia.');
    return media.fromUrl(user.id, String(body.url));
  }, { status: 201 });

  router.add('GET', '/api/media/:id', ({ user, params }) => {
    const m = media.byIds(user.id, [Number(params.id)])[0];
    if (!m) throw notFound('Mídia não encontrada.');
    return media.serialize(m);
  });

  // ---- Posts ----
  router.add('GET', '/api/posts', ({ user, query }) => posts.list(user, query));

  router.add('GET', '/api/posts/:id', ({ user, params }) => posts.serializeMany([posts.getOwned(user, params.id)], user.id)[0]);

  // Lote: { account_ids, type, items: [{ media_ids, caption, first_comment, scheduled_at, options }], spintax, publish_now, dry_run }
  router.add('POST', '/api/posts/batch', ({ user, body, auth }) => {
    const out = posts.createBatch(user, body, { source: auth.via === 'key' ? 'api' : 'app' });
    if (out.created && body.publish_now) scheduler.nudge();
    return out;
  }, { status: 201 });

  // Atalho para um post só: { account_ids, type, media_ids, caption, first_comment, scheduled_at, options }
  router.add('POST', '/api/posts', ({ user, body, auth }) => {
    const { account_ids, type, spintax, publish_now, dry_run, ...item } = body;
    const out = posts.createBatch(user, { account_ids, type, spintax, publish_now, dry_run, items: [item] }, { source: auth.via === 'key' ? 'api' : 'app' });
    if (out.created && publish_now) scheduler.nudge();
    return out;
  }, { status: 201 });

  router.add('PATCH', '/api/posts/:id', ({ user, params, body }) => posts.update(user, params.id, body));

  router.add('POST', '/api/posts/:id/publish-now', ({ user, params }) => {
    posts.requeue(user, params.id);
    scheduler.nudge();
    return { ok: true };
  });

  router.add('POST', '/api/posts/:id/retry', ({ user, params }) => {
    posts.requeue(user, params.id);
    scheduler.nudge();
    return { ok: true };
  });

  router.add('POST', '/api/posts/:id/cancel', ({ user, params }) => {
    posts.cancel(user, params.id);
    return { ok: true };
  });

  router.add('DELETE', '/api/posts/:id', ({ user, params }) => {
    posts.remove(user, params.id);
    return { ok: true };
  });

  // Cancela o que ainda está na fila de um lote inteiro.
  router.add('POST', '/api/batches/:id/cancel', ({ user, params, now }) => {
    const r = db.run("UPDATE posts SET status = 'canceled', updated_at = ? WHERE user_id = ? AND batch_id = ? AND status = 'scheduled'", now(), user.id, params.id);
    return { canceled: Number(r.changes) };
  });
}
