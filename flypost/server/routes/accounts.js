import { randomToken } from '../crypto.js';
import { HttpError, badRequest, notFound, redirect } from '../http.js';
import { planOf } from '../plans.js';
import { PLATFORMS } from '../../public/lib/rules.js';

const COLORS = ['#FF5A1F', '#2E90FA', '#12B76A', '#F79009', '#9E77ED', '#EE46BC', '#15B79E', '#667085'];

export function registerAccountRoutes(router, { db, config, accounts, oauth, cipher, events, now, logger }) {
  const ownedWorkspace = (user, id) => {
    const ws = db.get('SELECT * FROM workspaces WHERE id = ? AND user_id = ?', Number(id), user.id);
    if (!ws) throw notFound('Marca não encontrada.');
    return ws;
  };
  const ownedAccount = (user, id) => {
    const acc = db.get('SELECT * FROM accounts WHERE id = ? AND user_id = ?', Number(id), user.id);
    if (!acc) throw notFound('Conta não encontrada.');
    return acc;
  };

  // ---- Marcas (workspaces): agrupam as contas de um mesmo cliente/perfil ----

  router.add('GET', '/api/workspaces', ({ user }) => {
    const all = db.all('SELECT * FROM accounts WHERE user_id = ? ORDER BY platform, username', user.id).map(accounts.serialize);
    return db.all('SELECT * FROM workspaces WHERE user_id = ? ORDER BY id', user.id).map((w) => ({
      id: w.id,
      name: w.name,
      color: w.color,
      created_at: w.created_at,
      accounts: all.filter((a) => a.workspace_id === w.id),
    }));
  });

  router.add('POST', '/api/workspaces', ({ user, body }) => {
    const name = String(body.name || '').trim().slice(0, 60);
    if (!name) throw badRequest('Dê um nome para a marca.');
    const n = db.get('SELECT COUNT(*) AS n FROM workspaces WHERE user_id = ?', user.id).n;
    const max = planOf(user).workspaces;
    if (n >= max) throw new HttpError(403, `Seu plano permite ${max} marca${max > 1 ? 's' : ''}.`);
    const color = COLORS.includes(body.color) ? body.color : COLORS[n % COLORS.length];
    const r = db.run('INSERT INTO workspaces (user_id, name, color, created_at) VALUES (?,?,?,?)', user.id, name, color, now());
    return { id: Number(r.lastInsertRowid), name, color, accounts: [] };
  }, { status: 201 });

  router.add('PATCH', '/api/workspaces/:id', ({ user, params, body }) => {
    const ws = ownedWorkspace(user, params.id);
    const name = body.name != null ? String(body.name).trim().slice(0, 60) : ws.name;
    if (!name) throw badRequest('Dê um nome para a marca.');
    const color = COLORS.includes(body.color) ? body.color : ws.color;
    db.run('UPDATE workspaces SET name = ?, color = ? WHERE id = ?', name, color, ws.id);
    return { id: ws.id, name, color };
  });

  router.add('DELETE', '/api/workspaces/:id', ({ user, params }) => {
    const ws = ownedWorkspace(user, params.id);
    if (db.get('SELECT COUNT(*) AS n FROM workspaces WHERE user_id = ?', user.id).n <= 1) throw badRequest('Você precisa ter pelo menos uma marca.');
    if (db.get("SELECT 1 AS x FROM posts WHERE workspace_id = ? AND status = 'publishing'", ws.id)) throw badRequest('Há um post desta marca sendo publicado agora. Tente em instantes.');
    db.run('DELETE FROM workspaces WHERE id = ?', ws.id);
    return { ok: true };
  });

  // ---- Contas ----

  router.add('GET', '/api/accounts', ({ user }) => db.all('SELECT * FROM accounts WHERE user_id = ? ORDER BY workspace_id, platform, username', user.id).map(accounts.serialize));

  router.add('POST', '/api/accounts/simulated', ({ user, body }) => {
    const ws = ownedWorkspace(user, body.workspace_id);
    const platform = String(body.platform || '');
    if (!PLATFORMS[platform]) throw badRequest('Rede inválida.');
    const username = String(body.username || '').trim().replace(/^@/, '').slice(0, 40) || `teste_${platform}`;
    const r = accounts.upsert(user, ws.id, { platform, external_id: `sim-${randomToken(8)}`, username, display_name: username, avatar_url: null, access_token: 'simulado' }, 'simulated');
    events.log(user.id, { level: 'info', event: 'account.connected', accountId: r.id, message: `Conta de teste @${username} (${PLATFORMS[platform].label}) criada.` });
    return accounts.serialize(db.get('SELECT * FROM accounts WHERE id = ?', r.id));
  }, { status: 201 });

  router.add('PATCH', '/api/accounts/:id', ({ user, params, body }) => {
    const acc = ownedAccount(user, params.id);
    if (body.status != null) {
      if (!['active', 'disabled'].includes(body.status)) throw badRequest('Status inválido.');
      if (acc.status === 'expired' && body.status === 'active') throw badRequest('Reconecte a conta para reativá-la.');
      db.run('UPDATE accounts SET status = ?, updated_at = ? WHERE id = ?', body.status, now(), acc.id);
    }
    if (body.workspace_id != null && Number(body.workspace_id) !== acc.workspace_id) {
      const ws = ownedWorkspace(user, body.workspace_id);
      accounts.assertRoom(user, ws.id);
      db.tx(() => {
        db.run('UPDATE accounts SET workspace_id = ?, updated_at = ? WHERE id = ?', ws.id, now(), acc.id);
        db.run("UPDATE posts SET workspace_id = ? WHERE account_id = ? AND status IN ('draft','scheduled','failed')", ws.id, acc.id);
      });
    }
    if (body.settings && typeof body.settings === 'object') {
      const settings = { ...JSON.parse(acc.settings_json || '{}') };
      if (body.settings.tiktok_privacy) settings.tiktok_privacy = String(body.settings.tiktok_privacy);
      db.run('UPDATE accounts SET settings_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(settings), now(), acc.id);
    }
    return accounts.serialize(db.get('SELECT * FROM accounts WHERE id = ?', acc.id));
  });

  router.add('DELETE', '/api/accounts/:id', ({ user, params }) => {
    const acc = ownedAccount(user, params.id);
    if (db.get("SELECT 1 AS x FROM posts WHERE account_id = ? AND status = 'publishing'", acc.id)) throw badRequest('Há um post desta conta sendo publicado agora. Tente em instantes.');
    db.run('DELETE FROM accounts WHERE id = ?', acc.id);
    events.log(user.id, { level: 'info', event: 'account.removed', message: `Conta @${acc.username} removida.` });
    return { ok: true };
  });

  // ---- Login nas redes (OAuth) ----

  router.add('GET', '/api/oauth/:platform/start', ({ user, params, query }) => {
    const platform = params.platform;
    if (!PLATFORMS[platform]) throw notFound();
    if (!config.integrations[platform]) {
      throw badRequest(`A integração com ${PLATFORMS[platform].label} ainda não foi configurada no servidor. Veja o README.`);
    }
    const ws = ownedWorkspace(user, query.workspace_id);
    const state = randomToken(24);
    db.run('INSERT INTO oauth_states (state, user_id, platform, workspace_id, created_at) VALUES (?,?,?,?,?)', state, user.id, platform, ws.id, now());
    return { url: oauth[platform].authorizeUrl(state) };
  });

  router.add(
    'GET',
    '/oauth/:platform/callback',
    async ({ res, params, query }) => {
      const back = (q) => redirect(res, `/#/contas?${new URLSearchParams(q)}`);
      const st = db.get('SELECT * FROM oauth_states WHERE state = ? AND platform = ?', String(query.state || ''), params.platform);
      if (!st || now() - st.created_at > 30 * 60_000) return back({ erro: 'O login expirou. Tente conectar de novo.' });
      if (query.error || !query.code) {
        db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
        return back({ erro: query.error_description || query.error_message || 'A conexão foi cancelada.' });
      }
      const user = db.get('SELECT * FROM users WHERE id = ?', st.user_id);
      let profiles;
      try {
        profiles = await oauth[params.platform].exchange(String(query.code));
      } catch (err) {
        logger.warn(`[oauth] ${params.platform}: ${err.message}`);
        db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
        return back({ erro: `Não foi possível conectar: ${err.message}` });
      }
      if (!profiles.length) {
        db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
        return back({ erro: 'Nenhuma Página encontrada nessa conta do Facebook.' });
      }
      // Facebook: a pessoa escolhe quais Páginas conectar.
      if (params.platform === 'facebook') {
        db.run('UPDATE oauth_states SET payload_enc = ? WHERE state = ?', cipher.encrypt(JSON.stringify(profiles)), st.state);
        return back({ escolher: st.state });
      }
      db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
      try {
        const r = accounts.upsert(user, st.workspace_id, profiles[0]);
        events.log(user.id, { level: 'success', event: 'account.connected', accountId: r.id, message: `@${profiles[0].username} (${PLATFORMS[params.platform].label}) ${r.reconnected ? 'reconectada' : 'conectada'}.` });
        return back({ ok: profiles[0].username });
      } catch (err) {
        return back({ erro: err.message });
      }
    },
    { auth: 'none', raw: true },
  );

  router.add('GET', '/api/oauth/pending/:state', ({ user, params }) => {
    const st = db.get('SELECT * FROM oauth_states WHERE state = ? AND user_id = ?', params.state, user.id);
    if (!st?.payload_enc) throw notFound('Essa seleção expirou. Conecte de novo.');
    const connected = new Set(db.all('SELECT external_id FROM accounts WHERE user_id = ? AND platform = ?', user.id, st.platform).map((r) => r.external_id));
    return {
      workspace_id: st.workspace_id,
      pages: JSON.parse(cipher.decrypt(st.payload_enc)).map((p) => ({ id: p.external_id, name: p.display_name, avatar_url: p.avatar_url, connected: connected.has(p.external_id) })),
    };
  });

  router.add('POST', '/api/oauth/pending/:state', ({ user, params, body }) => {
    const st = db.get('SELECT * FROM oauth_states WHERE state = ? AND user_id = ?', params.state, user.id);
    if (!st?.payload_enc) throw notFound('Essa seleção expirou. Conecte de novo.');
    const wanted = new Set((body.page_ids || []).map(String));
    const pages = JSON.parse(cipher.decrypt(st.payload_enc)).filter((p) => wanted.has(p.external_id));
    if (!pages.length) throw badRequest('Escolha pelo menos uma Página.');
    const done = db.tx(() => pages.map((p) => ({ page: p, r: accounts.upsert(user, st.workspace_id, p) })));
    db.run('DELETE FROM oauth_states WHERE state = ?', st.state);
    for (const { page, r } of done) {
      events.log(user.id, { level: 'success', event: 'account.connected', accountId: r.id, message: `Página ${page.display_name} (Facebook) ${r.reconnected ? 'reconectada' : 'conectada'}.` });
    }
    return { connected: done.length };
  });
}
