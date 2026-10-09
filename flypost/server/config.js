import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Lê um .env simples (CHAVE=valor) sem sobrescrever o que já veio do ambiente.
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let value = m[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    process.env[m[1]] = value;
  }
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function secretFor(dataDir, provided) {
  if (provided) return provided;
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  fs.mkdirSync(dataDir, { recursive: true });
  const generated = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(file, generated, { mode: 0o600 });
  console.warn(`[config] APP_SECRET vazio: gerei um e salvei em ${file}. Faça backup — sem ele os tokens salvos não abrem.`);
  return generated;
}

export function loadConfig(overrides = {}) {
  if (!overrides.skipDotEnv) loadDotEnv(path.join(ROOT, '.env'));
  const env = { ...process.env, ...overrides.env };

  const port = int(env.PORT, 3000);
  const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '');
  const dataDir = path.resolve(ROOT, env.DATA_DIR || './data');

  const config = {
    port,
    publicUrl,
    dataDir,
    dbFile: overrides.dbFile || path.join(dataDir, 'flypost.db'),
    uploadDir: path.join(dataDir, 'uploads'),
    appSecret: overrides.appSecret || secretFor(dataDir, env.APP_SECRET),
    cookieSecure: publicUrl.startsWith('https://'),
    defaultPlan: env.DEFAULT_PLAN || 'teste',
    allowSignup: env.ALLOW_SIGNUP !== 'false',
    graphVersion: env.GRAPH_API_VERSION || 'v24.0',
    instagram: { appId: env.INSTAGRAM_APP_ID || '', appSecret: env.INSTAGRAM_APP_SECRET || '' },
    facebook: { appId: env.META_APP_ID || '', appSecret: env.META_APP_SECRET || '' },
    tiktok: { clientKey: env.TIKTOK_CLIENT_KEY || '', clientSecret: env.TIKTOK_CLIENT_SECRET || '' },
    scheduler: {
      intervalMs: int(env.SCHEDULER_INTERVAL_MS, 10_000),
      concurrency: Math.max(1, int(env.SCHEDULER_CONCURRENCY, 4)),
      maxAttempts: 3,
    },
    maxUploadBytes: int(env.MAX_UPLOAD_MB, 500) * 1024 * 1024,
    simFailRate: Number(env.SIM_FAIL_RATE || 0),
    ...overrides.config,
  };

  config.integrations = {
    instagram: Boolean(config.instagram.appId && config.instagram.appSecret),
    facebook: Boolean(config.facebook.appId && config.facebook.appSecret),
    tiktok: Boolean(config.tiktok.clientKey && config.tiktok.clientSecret),
  };
  return config;
}
