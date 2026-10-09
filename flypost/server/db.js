import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Cada item roda uma vez, em ordem; PRAGMA user_version guarda até onde já foi.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan          TEXT NOT NULL,
    timezone      TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE sessions (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE,
    user_agent   TEXT,
    ip           TEXT,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );

  CREATE TABLE workspaces (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#FF5A1F',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE accounts (
    id                 INTEGER PRIMARY KEY,
    user_id            INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id       INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    platform           TEXT NOT NULL,
    mode               TEXT NOT NULL DEFAULT 'live',
    external_id        TEXT NOT NULL,
    username           TEXT NOT NULL,
    display_name       TEXT,
    avatar_url         TEXT,
    access_token_enc   TEXT,
    refresh_token_enc  TEXT,
    token_expires_at   INTEGER,
    refresh_expires_at INTEGER,
    token_issued_at    INTEGER,
    status             TEXT NOT NULL DEFAULT 'active',
    status_detail      TEXT,
    settings_json      TEXT NOT NULL DEFAULT '{}',
    created_at         INTEGER NOT NULL,
    updated_at         INTEGER NOT NULL,
    UNIQUE (user_id, platform, external_id)
  );

  CREATE TABLE media (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    file          TEXT NOT NULL UNIQUE,
    original_name TEXT,
    mime          TEXT NOT NULL,
    kind          TEXT NOT NULL,
    size          INTEGER NOT NULL,
    width         INTEGER,
    height        INTEGER,
    duration_ms   INTEGER,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE posts (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id    INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    account_id      INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    batch_id        TEXT,
    type            TEXT NOT NULL,
    caption         TEXT NOT NULL DEFAULT '',
    first_comment   TEXT,
    media_ids       TEXT NOT NULL,
    options_json    TEXT NOT NULL DEFAULT '{}',
    scheduled_at    INTEGER NOT NULL,
    status          TEXT NOT NULL,
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    locked_at       INTEGER,
    last_error      TEXT,
    remote_id       TEXT,
    permalink       TEXT,
    published_at    INTEGER,
    source          TEXT NOT NULL DEFAULT 'app',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL
  );
  CREATE INDEX posts_due     ON posts (status, scheduled_at);
  CREATE INDEX posts_user    ON posts (user_id, scheduled_at);
  CREATE INDEX posts_account ON posts (account_id, scheduled_at);

  CREATE TABLE logs (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    post_id    INTEGER,
    account_id INTEGER,
    level      TEXT NOT NULL,
    event      TEXT NOT NULL,
    message    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX logs_user ON logs (user_id, id DESC);

  CREATE TABLE api_keys (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,
    key_hash     TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  );

  CREATE TABLE webhooks (
    id               INTEGER PRIMARY KEY,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url              TEXT NOT NULL,
    secret           TEXT NOT NULL,
    events           TEXT NOT NULL,
    active           INTEGER NOT NULL DEFAULT 1,
    created_at       INTEGER NOT NULL,
    last_status      INTEGER,
    last_error       TEXT,
    last_delivery_at INTEGER
  );

  CREATE TABLE oauth_states (
    state        TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform     TEXT NOT NULL,
    workspace_id INTEGER NOT NULL,
    payload_enc  TEXT,
    created_at   INTEGER NOT NULL
  );
  `,
];

function clean(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v));
}

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const current = raw.prepare('PRAGMA user_version').get().user_version;
  for (let v = current; v < MIGRATIONS.length; v++) {
    raw.exec('BEGIN');
    try {
      raw.exec(MIGRATIONS[v]);
      raw.exec(`PRAGMA user_version = ${v + 1}`);
      raw.exec('COMMIT');
    } catch (err) {
      raw.exec('ROLLBACK');
      throw err;
    }
  }

  const cache = new Map();
  const stmt = (sql) => {
    let s = cache.get(sql);
    if (!s) cache.set(sql, (s = raw.prepare(sql)));
    return s;
  };
  let depth = 0;

  return {
    raw,
    get: (sql, ...params) => stmt(sql).get(...clean(params)),
    all: (sql, ...params) => stmt(sql).all(...clean(params)),
    run: (sql, ...params) => stmt(sql).run(...clean(params)),
    tx(fn) {
      if (depth > 0) return fn();
      depth++;
      raw.exec('BEGIN IMMEDIATE');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      } finally {
        depth--;
      }
    },
    close: () => raw.close(),
  };
}
