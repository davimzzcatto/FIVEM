import { randomToken } from '../crypto.js';
import { badRequest, notFound } from '../http.js';
import { WEBHOOK_EVENTS } from '../events.js';

export function registerIntegrationRoutes(router, { db, auth, events, now }) {
  // ---- Chaves de API ----
  router.add('GET', '/api/keys', ({ user }) =>
    db.all('SELECT id, name, prefix, created_at, last_used_at FROM api_keys WHERE user_id = ? AND revoked_at IS NULL ORDER BY id DESC', user.id),
  );

  router.add('POST', '/api/keys', ({ user, body, auth: who }) => {
    if (who.via === 'key') throw badRequest('Crie chaves pelo painel, não pela própria API.');
    const name = String(body.name || '').trim().slice(0, 60) || 'Minha integração';
    if (db.get('SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ? AND revoked_at IS NULL', user.id).n >= 20) throw badRequest('Limite de 20 chaves ativas.');
    return auth.createApiKey(user.id, name);
  }, { status: 201 });

  router.add('DELETE', '/api/keys/:id', ({ user, params }) => {
    db.run('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', now(), Number(params.id), user.id);
    return { ok: true };
  });

  // ---- Webhooks ----
  const serialize = (h) => ({
    id: h.id,
    url: h.url,
    events: JSON.parse(h.events),
    active: Boolean(h.active),
    secret: h.secret,
    created_at: h.created_at,
    last_status: h.last_status,
    last_error: h.last_error,
    last_delivery_at: h.last_delivery_at,
  });

  const validate = (body) => {
    let url;
    try {
      url = new URL(String(body.url || ''));
    } catch {
      throw badRequest('URL do webhook inválida.');
    }
    if (!['https:', 'http:'].includes(url.protocol)) throw badRequest('O webhook precisa de uma URL http(s).');
    const list = Array.isArray(body.events) ? body.events.filter((e) => WEBHOOK_EVENTS.includes(e)) : WEBHOOK_EVENTS;
    if (!list.length) throw badRequest('Escolha pelo menos um evento.');
    return { url: url.toString(), events: list };
  };

  const owned = (user, id) => {
    const h = db.get('SELECT * FROM webhooks WHERE id = ? AND user_id = ?', Number(id), user.id);
    if (!h) throw notFound('Webhook não encontrado.');
    return h;
  };

  router.add('GET', '/api/webhooks', ({ user }) => db.all('SELECT * FROM webhooks WHERE user_id = ? ORDER BY id', user.id).map(serialize));

  router.add('POST', '/api/webhooks', ({ user, body }) => {
    const { url, events: list } = validate(body);
    if (db.get('SELECT COUNT(*) AS n FROM webhooks WHERE user_id = ?', user.id).n >= 10) throw badRequest('Limite de 10 webhooks.');
    const r = db.run('INSERT INTO webhooks (user_id, url, secret, events, active, created_at) VALUES (?,?,?,?,1,?)', user.id, url, `whsec_${randomToken(24)}`, JSON.stringify(list), now());
    return serialize(db.get('SELECT * FROM webhooks WHERE id = ?', r.lastInsertRowid));
  }, { status: 201 });

  router.add('PATCH', '/api/webhooks/:id', ({ user, params, body }) => {
    const h = owned(user, params.id);
    const next = body.url != null || body.events != null ? validate({ url: body.url ?? h.url, events: body.events ?? JSON.parse(h.events) }) : { url: h.url, events: JSON.parse(h.events) };
    const active = body.active != null ? Boolean(body.active) : Boolean(h.active);
    db.run('UPDATE webhooks SET url = ?, events = ?, active = ? WHERE id = ?', next.url, JSON.stringify(next.events), active, h.id);
    return serialize(db.get('SELECT * FROM webhooks WHERE id = ?', h.id));
  });

  router.add('DELETE', '/api/webhooks/:id', ({ user, params }) => {
    db.run('DELETE FROM webhooks WHERE id = ?', owned(user, params.id).id);
    return { ok: true };
  });

  router.add('POST', '/api/webhooks/:id/test', async ({ user, params }) => {
    const h = owned(user, params.id);
    return events.deliver(h, 'webhook.test', { message: 'Teste do FlyPost: se você recebeu isto, o webhook está funcionando.' });
  });
}
