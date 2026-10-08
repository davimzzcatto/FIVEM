import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import zlib from 'node:zlib';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';

const quiet = { log() {}, warn() {}, error() {}, info() {} };

// Sobe o app inteiro numa porta livre, com banco e uploads numa pasta temporária.
export async function startApp({ fetch, clock, env = {}, ...opts } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flypost-test-'));
  const config = loadConfig({
    skipDotEnv: true,
    appSecret: 'segredo-de-teste',
    env: { DATA_DIR: dir, PUBLIC_URL: 'https://flypost.test', ...env },
  });
  const app = createApp({ config, fetch, now: clock ? () => clock.t : undefined, sleep: async () => {}, logger: quiet, allowPrivateUrls: true, ...opts });
  const server = http.createServer(app.handler);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    app,
    base,
    dir,
    client: () => createClient(base),
    async close() {
      await new Promise((r) => server.close(r));
      await app.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// Cliente HTTP com cookie de sessão e o cabeçalho anti-CSRF do app.
export function createClient(base) {
  let cookie = '';
  let bearer = '';
  async function call(method, url, body, headers = {}) {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    else h['X-FlyPost'] = '1';
    let payload;
    if (body instanceof Buffer) payload = body;
    else if (body !== undefined) {
      h['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + url, { method, headers: h, body: payload, redirect: 'manual' });
    const set = res.headers.getSetCookie?.() || [];
    for (const c of set) if (c.startsWith('fp_session=')) cookie = c.split(';')[0];
    const text = await res.text();
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* não-JSON */
    }
    return { status: res.status, data, headers: res.headers };
  }
  return {
    get: (u, hd) => call('GET', u, undefined, hd),
    post: (u, b = {}, hd) => call('POST', u, b, hd),
    patch: (u, b = {}) => call('PATCH', u, b),
    put: (u, buf, hd) => call('PUT', u, buf, hd),
    del: (u, b) => call('DELETE', u, b),
    useKey(k) {
      bearer = k;
      cookie = '';
    },
    async signup(email = 'ana@exemplo.com', name = 'Ana') {
      const r = await call('POST', '/api/auth/signup', { name, email, password: 'senha-forte-1', timezone: 'America/Sao_Paulo' });
      if (r.status !== 201) throw new Error(`signup falhou: ${JSON.stringify(r.data)}`);
      return r.data.user;
    },
  };
}

// PNG mínimo válido com as dimensões pedidas (cor sólida).
export function png(width, height) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((width * 3 + 1) * height, 0x80);
  for (let y = 0; y < height; y++) raw[y * (width * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Cabeçalho JPEG mínimo (SOI + SOF0) — basta para o leitor de dimensões e o detector de formato.
export function jpeg(width, height) {
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1'), sof, Buffer.from([0xff, 0xd9])]);
}

// Um "MP4" falso (caixa ftyp) — o servidor reconhece pelo cabeçalho; dimensões vêm da dica.
export function mp4(size = 2048) {
  const buf = Buffer.alloc(size);
  buf.writeUInt32BE(24, 0);
  buf.write('ftypisom', 4, 'latin1');
  return buf;
}

// fetch falso: roteia por URL e registra as chamadas.
export function mockFetch(routes, passthrough = globalThis.fetch) {
  const calls = [];
  async function fake(input, init = {}) {
    const url = String(input instanceof URL ? input.href : input);
    const body = init.body instanceof Buffer ? init.body : init.body ? String(init.body) : '';
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body });
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? url.includes(match) : match.test(url)) {
        const out = await handler({ url: new URL(url), init, body, calls });
        // { status, json } ou { status, raw } definem a resposta; qualquer outro objeto vira o corpo JSON com 200.
        const spec = out && typeof out === 'object' && ('json' in out || 'raw' in out);
        const status = spec ? out.status || 200 : 200;
        const payload = spec ? (out.raw ?? JSON.stringify(out.json)) : JSON.stringify(out ?? {});
        return new Response(payload, { status, headers: { 'Content-Type': 'application/json' } });
      }
    }
    if (passthrough) return passthrough(input, init);
    throw new Error(`fetch não esperado: ${url}`);
  }
  fake.calls = calls;
  return fake;
}

export const form = (body) => Object.fromEntries(new URLSearchParams(body));
