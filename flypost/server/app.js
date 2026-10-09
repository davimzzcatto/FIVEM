import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, ROOT } from './config.js';
import { openDb } from './db.js';
import { createCipher } from './crypto.js';
import { createRouter, HttpError, notFound, readJson, sendJson, sendFile } from './http.js';
import { createAuth } from './auth.js';
import { createEvents } from './events.js';
import { createOAuth } from './oauth.js';
import { createAccounts } from './accounts.js';
import { createMedia } from './media.js';
import { createPosts } from './posts.js';
import { createPublishers } from './publishers/index.js';
import { createScheduler } from './scheduler.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerPostRoutes } from './routes/posts.js';
import { registerInsightRoutes } from './routes/insights.js';
import { registerIntegrationRoutes } from './routes/integrations.js';

const PUBLIC_DIR = path.join(ROOT, 'public');
const MEDIA_FILE = /^[A-Za-z0-9_-]+\.(jpg|png|mp4|mov)$/;

// Monta o app inteiro. Os testes passam fetch/now/sleep falsos por aqui.
export function createApp(opts = {}) {
  const config = opts.config || loadConfig();
  const fetch = opts.fetch || globalThis.fetch;
  const now = opts.now || Date.now;
  const logger = opts.logger || console;

  const db = openDb(config.dbFile);
  const cipher = createCipher(config.appSecret);
  const events = createEvents({ db, fetch, now, logger, allowPrivateUrls: opts.allowPrivateUrls });
  const oauth = createOAuth({ config, fetch, now });
  const accounts = createAccounts({ db, cipher, oauth, events, now, logger });
  const media = createMedia({ db, config, fetch, now, allowPrivateUrls: opts.allowPrivateUrls });
  const posts = createPosts({ db, media, accounts, now, random: opts.random });
  const publishers = opts.publishers || createPublishers({ config });
  const scheduler = createScheduler({ db, config, publishers, accounts, media, events, fetch, now, sleep: opts.sleep, logger });
  const auth = createAuth({ db, config, now });

  const router = createRouter();
  const deps = { db, config, cipher, events, oauth, accounts, media, posts, scheduler, auth, now, logger };
  registerAuthRoutes(router, deps);
  registerAccountRoutes(router, deps);
  registerPostRoutes(router, deps);
  registerInsightRoutes(router, deps);
  registerIntegrationRoutes(router, deps);

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    try {
      // Mídia pública: a Meta e o TikTok baixam por aqui. O nome do arquivo é aleatório e impossível de adivinhar.
      if (pathname.startsWith('/m/')) {
        const name = pathname.slice(3);
        if (MEDIA_FILE.test(name) && sendFile(req, res, path.join(config.uploadDir, name), { cache: 'public, max-age=86400' })) return;
        throw notFound();
      }

      const method = req.method === 'HEAD' ? 'GET' : req.method;
      const match = router.match(method, pathname);
      if (match?.methodNotAllowed) throw new HttpError(405, 'Método não permitido.');
      if (match) {
        const isApi = pathname.startsWith('/api/');
        const bearer = /^Bearer\s/i.test(req.headers.authorization || '');
        // Proteção contra CSRF: chamadas do navegador que alteram algo precisam deste cabeçalho,
        // que um formulário de outro site não consegue enviar.
        if (isApi && !bearer && !['GET', 'HEAD'].includes(method) && req.headers['x-flypost'] !== '1') {
          throw new HttpError(403, 'Requisição bloqueada (cabeçalho X-FlyPost ausente).');
        }
        let who = null;
        if (match.opts.auth === 'none') {
          try {
            who = auth.identify(req);
          } catch {
            who = null;
          }
        } else {
          who = auth.identify(req);
          if (!who) throw new HttpError(401, 'Faça login para continuar.');
        }
        const ctx = {
          req,
          res,
          url,
          now,
          query: Object.fromEntries(url.searchParams),
          params: match.params,
          user: who?.user,
          auth: who || {},
          session: who,
          body: match.opts.raw || ['GET', 'HEAD'].includes(method) ? {} : await readJson(req),
        };
        const out = await match.handler(ctx);
        if (res.headersSent || res.writableEnded) return;
        return sendJson(res, match.opts.status || 200, out ?? { ok: true });
      }

      if (pathname.startsWith('/api/')) throw notFound('Rota não encontrada.');
      if (!['GET', 'HEAD'].includes(req.method)) throw new HttpError(405, 'Método não permitido.');

      const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
      const file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (file.startsWith(PUBLIC_DIR + path.sep) && sendFile(req, res, file)) return;
      throw notFound();
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) logger.error('[http]', req.method, pathname, err);
      if (res.headersSent) return res.destroy();
      if (!pathname.startsWith('/api/') && status === 404) {
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end('<!doctype html><meta charset="utf-8"><title>Não encontrado</title><p style="font-family:system-ui;padding:40px">Página não encontrada. <a href="/">Voltar ao FlyPost</a></p>');
      }
      // Corpo que não foi lido inteiro (ex.: upload recusado): fecha a conexão depois de responder.
      if (!req.complete) res.setHeader('Connection', 'close');
      sendJson(res, status, { error: status === 500 ? 'Erro interno. Tente de novo em instantes.' : err.message, details: err.details });
    }
  }

  return {
    handler,
    config,
    db,
    scheduler,
    events,
    auth,
    async close() {
      await scheduler.stop();
      await events.settle();
      db.close();
    },
  };
}

export function ensureDirs(config) {
  fs.mkdirSync(config.uploadDir, { recursive: true });
}
