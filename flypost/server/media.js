import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import { randomToken } from './crypto.js';
import { HttpError, badRequest } from './http.js';

export const ACCEPTED = {
  'image/jpeg': { ext: '.jpg', kind: 'image' },
  'image/png': { ext: '.png', kind: 'image' },
  'video/mp4': { ext: '.mp4', kind: 'video' },
  'video/quicktime': { ext: '.mov', kind: 'video' },
};

// Lê largura/altura do cabeçalho de JPEG ou PNG sem decodificar a imagem.
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      const isSof = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (isSof) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

function sniff(buf) {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp') {
    return buf.toString('latin1', 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4';
  }
  return null;
}

let ffprobeAvailable;
function probeVideo(file) {
  return new Promise((resolve) => {
    if (ffprobeAvailable === false) return resolve(null);
    execFile(
      'ffprobe',
      ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:stream_tags=rotate:stream_side_data=rotation:format=duration', '-of', 'json', file],
      { timeout: 15_000 },
      (err, stdout) => {
        if (err) {
          if (err.code === 'ENOENT') ffprobeAvailable = false;
          return resolve(null);
        }
        try {
          const info = JSON.parse(stdout);
          const s = info.streams?.[0] || {};
          const rotation = Math.abs(Number(s.tags?.rotate ?? s.side_data_list?.[0]?.rotation ?? 0));
          const swap = rotation === 90 || rotation === 270;
          resolve({
            width: swap ? s.height : s.width,
            height: swap ? s.width : s.height,
            duration_ms: info.format?.duration ? Math.round(Number(info.format.duration) * 1000) : null,
          });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

// Bloqueia downloads para a rede interna (SSRF) ao importar mídia por URL.
function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

export async function assertPublicUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw badRequest('URL inválida.');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Use uma URL http ou https.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw badRequest('Não consegui resolver o endereço da URL.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw badRequest('Essa URL aponta para uma rede interna.');
  return url;
}

export function createMedia({ db, config, fetch, now = Date.now, allowPrivateUrls = false }) {
  fs.mkdirSync(config.uploadDir, { recursive: true });

  const filePath = (m) => path.join(config.uploadDir, m.file);
  const publicUrl = (m) => `${config.publicUrl}/m/${m.file}`;

  // Grava um stream no disco respeitando o limite de tamanho; devolve o registro criado.
  async function store(userId, stream, { mime, originalName, hint = {} }) {
    const tmp = path.join(config.uploadDir, `.tmp-${randomToken(12)}`);
    let size = 0;
    let head = Buffer.alloc(0);
    const limit = config.maxUploadBytes;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (size > limit) return cb(new HttpError(413, `Arquivo maior que ${Math.round(limit / 1048576)} MB.`));
        if (head.length < 256 * 1024) head = Buffer.concat([head, chunk]).subarray(0, 256 * 1024);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, counter, fs.createWriteStream(tmp));
    } catch (err) {
      fs.rmSync(tmp, { force: true });
      throw err instanceof HttpError ? err : new HttpError(400, 'Falha ao receber o arquivo.');
    }
    if (!size) {
      fs.rmSync(tmp, { force: true });
      throw badRequest('Arquivo vazio.');
    }

    const real = sniff(head) || mime;
    const type = ACCEPTED[real];
    if (!type) {
      fs.rmSync(tmp, { force: true });
      throw badRequest('Formato não aceito. Envie JPG, PNG, MP4 ou MOV.');
    }
    const file = `${randomToken(18)}${type.ext}`;
    fs.renameSync(tmp, path.join(config.uploadDir, file));

    let meta = { width: num(hint.width), height: num(hint.height), duration_ms: num(hint.duration_ms) };
    if (type.kind === 'image') meta = { ...meta, ...(imageSize(head) || {}), duration_ms: null };
    else meta = { ...meta, ...((await probeVideo(path.join(config.uploadDir, file))) || {}) };

    const row = db.run(
      'INSERT INTO media (user_id, file, original_name, mime, kind, size, width, height, duration_ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
      userId,
      file,
      String(originalName || file).slice(0, 200),
      real,
      type.kind,
      size,
      meta.width,
      meta.height,
      meta.duration_ms,
      now(),
    );
    return serialize(db.get('SELECT * FROM media WHERE id = ?', row.lastInsertRowid));
  }

  async function fromUrl(userId, rawUrl) {
    let url = rawUrl;
    let res;
    for (let hop = 0; hop < 4; hop++) {
      const checked = allowPrivateUrls ? new URL(url) : await assertPublicUrl(url);
      res = await fetch(checked, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location'), checked).toString();
        continue;
      }
      break;
    }
    if (!res.ok || !res.body) throw badRequest(`Não consegui baixar a mídia (HTTP ${res.status}).`);
    const mime = String(res.headers.get('content-type') || '').split(';')[0].trim();
    const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'arquivo');
    return store(userId, Readable.fromWeb(res.body), { mime, originalName: name });
  }

  function serialize(m) {
    if (!m) return null;
    return { id: m.id, kind: m.kind, mime: m.mime, size: m.size, width: m.width, height: m.height, duration_ms: m.duration_ms, name: m.original_name, url: `/m/${m.file}`, created_at: m.created_at };
  }

  function byIds(userId, ids) {
    if (!ids.length) return [];
    const rows = db.all(`SELECT * FROM media WHERE user_id = ? AND id IN (${ids.map(() => '?').join(',')})`, userId, ...ids);
    const map = new Map(rows.map((r) => [r.id, r]));
    return ids.map((id) => map.get(id)).filter(Boolean);
  }

  // Apaga arquivos que nenhum post ativo usa mais. Mantém a mídia de publicados por 30 dias (prévia no calendário).
  function collectGarbage() {
    const t = now();
    const rows = db.all(
      `SELECT m.id, m.file FROM media m
       WHERE m.created_at < ?
         AND NOT EXISTS (
           SELECT 1 FROM posts p
           WHERE p.user_id = m.user_id
             AND (EXISTS (SELECT 1 FROM json_each(p.media_ids) j WHERE j.value = m.id)
                  OR json_extract(p.options_json, '$.cover_media_id') = m.id)
             AND (p.status IN ('draft','scheduled','publishing','failed')
                  OR p.updated_at > ?)
         )`,
      t - 2 * 86_400_000,
      t - 30 * 86_400_000,
    );
    for (const r of rows) {
      fs.rmSync(path.join(config.uploadDir, r.file), { force: true });
      db.run('DELETE FROM media WHERE id = ?', r.id);
    }
    return rows.length;
  }

  function removeFiles(rows) {
    for (const r of rows) fs.rmSync(path.join(config.uploadDir, r.file), { force: true });
  }

  return { store, fromUrl, serialize, byIds, filePath, publicUrl, collectGarbage, removeFiles };
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
