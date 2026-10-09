import { hashPassword, verifyPassword } from '../crypto.js';
import { HttpError, badRequest } from '../http.js';
import { publicUser } from '../auth.js';
import { PLANS, planOf, monthlyUsage } from '../plans.js';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validTimezone(tz) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function registerAuthRoutes(router, { db, config, auth, media, now }) {
  router.add('GET', '/api/config', () => ({ allowSignup: config.allowSignup, integrations: config.integrations, plans: PLANS, publicUrl: config.publicUrl }), { auth: 'none' });

  router.add(
    'POST',
    '/api/auth/signup',
    async ({ req, res, body }) => {
      if (!config.allowSignup) throw new HttpError(403, 'O cadastro está fechado. Fale com quem administra o FlyPost.');
      const name = String(body.name || '').trim();
      const email = String(body.email || '').trim().toLowerCase();
      const password = String(body.password || '');
      if (!name) throw badRequest('Informe seu nome.');
      if (!EMAIL.test(email)) throw badRequest('E-mail inválido.');
      if (password.length < 8) throw badRequest('A senha precisa ter pelo menos 8 caracteres.');
      if (db.get('SELECT id FROM users WHERE email = ?', email)) throw new HttpError(409, 'Já existe uma conta com esse e-mail.');
      const timezone = validTimezone(body.timezone) ? body.timezone : 'America/Sao_Paulo';
      const hash = await hashPassword(password);
      const userId = db.tx(() => {
        const t = now();
        const u = db.run('INSERT INTO users (email, name, password_hash, plan, timezone, created_at) VALUES (?,?,?,?,?,?)', email, name, hash, config.defaultPlan, timezone, t);
        db.run('INSERT INTO workspaces (user_id, name, created_at) VALUES (?,?,?)', u.lastInsertRowid, 'Minha marca', t);
        return Number(u.lastInsertRowid);
      });
      auth.startSession(req, res, userId);
      return { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', userId)) };
    },
    { auth: 'none', status: 201 },
  );

  router.add(
    'POST',
    '/api/auth/login',
    async ({ req, res, body }) => {
      const email = String(body.email || '').trim().toLowerCase();
      const release = auth.throttle(req, email);
      const user = db.get('SELECT * FROM users WHERE email = ?', email);
      // Verifica a senha mesmo sem usuário, para o tempo de resposta não revelar quem tem conta.
      const ok = await verifyPassword(String(body.password || ''), user?.password_hash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      if (!user || !ok) throw new HttpError(401, 'E-mail ou senha incorretos.');
      release();
      auth.startSession(req, res, user.id);
      return { user: publicUser(user) };
    },
    { auth: 'none' },
  );

  router.add('POST', '/api/auth/logout', ({ req, res }) => {
    auth.endSession(req, res);
    return { ok: true };
  }, { auth: 'none' });

  router.add('GET', '/api/me', ({ user }) => ({
    user: publicUser(user),
    plan: planOf(user),
    usage: monthlyUsage(db, user, now()),
    integrations: config.integrations,
  }));

  router.add('PATCH', '/api/me', ({ user, body }) => {
    const name = body.name != null ? String(body.name).trim() : user.name;
    const email = body.email != null ? String(body.email).trim().toLowerCase() : user.email;
    const timezone = body.timezone != null ? String(body.timezone) : user.timezone;
    if (!name) throw badRequest('Informe seu nome.');
    if (!EMAIL.test(email)) throw badRequest('E-mail inválido.');
    if (!validTimezone(timezone)) throw badRequest('Fuso horário inválido.');
    if (email !== user.email && db.get('SELECT id FROM users WHERE email = ? AND id != ?', email, user.id)) throw new HttpError(409, 'Esse e-mail já está em uso.');
    db.run('UPDATE users SET name = ?, email = ?, timezone = ? WHERE id = ?', name, email, timezone, user.id);
    return { user: publicUser(db.get('SELECT * FROM users WHERE id = ?', user.id)) };
  });

  router.add('POST', '/api/me/password', async ({ user, body, session }) => {
    if (!(await verifyPassword(String(body.current || ''), user.password_hash))) throw badRequest('A senha atual não confere.');
    const next = String(body.next || '');
    if (next.length < 8) throw badRequest('A nova senha precisa ter pelo menos 8 caracteres.');
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', await hashPassword(next), user.id);
    // Troca de senha derruba as outras sessões.
    db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, session?.sessionId ?? -1);
    return { ok: true };
  });

  router.add('GET', '/api/me/sessions', ({ user, session }) =>
    db
      .all('SELECT id, user_agent, ip, created_at, last_seen_at FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC', user.id)
      .map((s) => ({ ...s, current: s.id === session?.sessionId })),
  );

  router.add('DELETE', '/api/me/sessions/:id', ({ user, params }) => {
    db.run('DELETE FROM sessions WHERE id = ? AND user_id = ?', Number(params.id), user.id);
    return { ok: true };
  });

  router.add('DELETE', '/api/me', async ({ req, res, user, body }) => {
    if (!(await verifyPassword(String(body.password || ''), user.password_hash))) throw badRequest('Senha incorreta.');
    const files = db.all('SELECT file FROM media WHERE user_id = ?', user.id);
    db.run('DELETE FROM users WHERE id = ?', user.id);
    media.removeFiles(files);
    auth.endSession(req, res);
    return { ok: true };
  });
}
