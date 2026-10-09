import { randomToken, sha256 } from './crypto.js';
import { HttpError, parseCookies, setCookie, clientIp } from './http.js';

export const SESSION_COOKIE = 'fp_session';
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const TOUCH_EVERY = 10 * 60 * 1000;

export function createAuth({ db, config, now = Date.now }) {
  // Tentativas de login por IP+e-mail, em memória: 10 a cada 15 minutos.
  const attempts = new Map();

  function throttle(req, email) {
    const key = `${clientIp(req)}|${String(email).toLowerCase()}`;
    const t = now();
    const list = (attempts.get(key) || []).filter((at) => t - at < 15 * 60 * 1000);
    if (list.length >= 10) throw new HttpError(429, 'Muitas tentativas. Espere alguns minutos e tente de novo.');
    list.push(t);
    attempts.set(key, list);
    return () => attempts.delete(key);
  }

  function startSession(req, res, userId) {
    const token = randomToken(32);
    const t = now();
    db.run(
      'INSERT INTO sessions (user_id, token_hash, user_agent, ip, created_at, last_seen_at, expires_at) VALUES (?,?,?,?,?,?,?)',
      userId,
      sha256(token),
      String(req.headers['user-agent'] || '').slice(0, 300),
      clientIp(req),
      t,
      t,
      t + SESSION_TTL,
    );
    setCookie(res, SESSION_COOKIE, token, { maxAge: SESSION_TTL, secure: config.cookieSecure });
  }

  function endSession(req, res) {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
    setCookie(res, SESSION_COOKIE, '', { maxAge: 0, secure: config.cookieSecure });
  }

  // Resolve quem está chamando: chave de API (Authorization: Bearer) ou cookie de sessão.
  function identify(req) {
    const t = now();
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
    if (bearer) {
      const key = db.get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', sha256(bearer[1]));
      if (!key) throw new HttpError(401, 'Chave de API inválida ou revogada.');
      if (!key.last_used_at || t - key.last_used_at > 60_000) db.run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', t, key.id);
      const user = db.get('SELECT * FROM users WHERE id = ?', key.user_id);
      return user ? { user, via: 'key', keyId: key.id } : null;
    }
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (!token) return null;
    const session = db.get('SELECT * FROM sessions WHERE token_hash = ?', sha256(token));
    if (!session) return null;
    if (session.expires_at < t) {
      db.run('DELETE FROM sessions WHERE id = ?', session.id);
      return null;
    }
    if (t - session.last_seen_at > TOUCH_EVERY) {
      db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', t, t + SESSION_TTL, session.id);
    }
    const user = db.get('SELECT * FROM users WHERE id = ?', session.user_id);
    return user ? { user, via: 'session', sessionId: session.id } : null;
  }

  function createApiKey(userId, name) {
    const secret = `fp_live_${randomToken(24)}`;
    const prefix = secret.slice(0, 14);
    const row = db.run('INSERT INTO api_keys (user_id, name, prefix, key_hash, created_at) VALUES (?,?,?,?,?)', userId, name, prefix, sha256(secret), now());
    return { id: Number(row.lastInsertRowid), name, prefix, secret };
  }

  return { throttle, startSession, endSession, identify, createApiKey };
}

export function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, plan: user.plan, timezone: user.timezone, created_at: user.created_at };
}
