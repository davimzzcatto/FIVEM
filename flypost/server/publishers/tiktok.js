import fs from 'node:fs/promises';
import { PublishError, networkError } from './errors.js';

const API = 'https://open.tiktokapis.com/v2';
const MB = 1024 * 1024;

// Regras de upload em partes do TikTok: cada parte entre 5 e 64 MB, a última absorve a sobra.
export function planChunks(size) {
  if (size <= 64 * MB) return { chunkSize: size, count: 1 };
  const chunkSize = 10 * MB;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

export async function tiktokCall(fetch, path, token, body) {
  let res;
  try {
    res = await fetch(`${API}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw networkError(err);
  }
  const json = await res.json().catch(() => ({}));
  const code = json.error?.code;
  if (res.ok && (!code || code === 'ok')) return json.data || {};
  const msg = json.error?.message || `HTTP ${res.status}`;
  if (code === 'access_token_invalid' || code === 'scope_not_authorized' || res.status === 401) {
    throw new PublishError(`Acesso ao TikTok expirado ou sem permissão: ${msg}`, { auth: true, code });
  }
  if (code === 'rate_limit_exceeded' || res.status === 429 || res.status >= 500) {
    throw new PublishError(`TikTok indisponível no momento: ${msg}`, { retryable: true, code });
  }
  if (code === 'spam_risk_too_many_posts') throw new PublishError('A conta bateu o limite diário de posts do TikTok.', { code });
  if (code === 'unaudited_client_can_only_post_to_private_accounts') {
    throw new PublishError('O app do TikTok ainda não foi auditado: só dá para publicar como privado (Somente eu).', { code });
  }
  throw new PublishError(`TikTok: ${msg}`, { code });
}

export function createTiktokPublisher() {
  async function publish({ post, account, media, ctx }) {
    const token = account.accessToken;
    const video = media[0];
    const opts = post.options || {};

    // O TikTok exige consultar o criador antes de cada post e respeitar as opções que ele devolve.
    const creator = await tiktokCall(ctx.fetch, '/post/publish/creator_info/query/', token);
    const allowed = creator.privacy_level_options || ['SELF_ONLY'];
    const wanted = opts.tiktok_privacy || account.settings?.tiktok_privacy || 'SELF_ONLY';
    const privacy = allowed.includes(wanted) ? wanted : allowed.includes('SELF_ONLY') ? 'SELF_ONLY' : allowed[0];
    if (privacy !== wanted) ctx.warn(`Privacidade "${wanted}" não disponível para esta conta; publicado como "${privacy}".`);
    const maxSec = creator.max_video_post_duration_sec;
    if (maxSec && video.duration_ms && video.duration_ms / 1000 > maxSec) {
      throw new PublishError(`O vídeo passa de ${maxSec}s, o máximo que esta conta do TikTok aceita.`);
    }

    const file = ctx.filePath(video);
    const { size } = await fs.stat(file);
    const { chunkSize, count } = planChunks(size);
    const init = await tiktokCall(ctx.fetch, '/post/publish/video/init/', token, {
      post_info: {
        title: post.caption.slice(0, 2200),
        privacy_level: privacy,
        disable_comment: Boolean(opts.disable_comment || creator.comment_disabled),
        disable_duet: Boolean(opts.disable_duet || creator.duet_disabled),
        disable_stitch: Boolean(opts.disable_stitch || creator.stitch_disabled),
        video_cover_timestamp_ms: opts.thumb_offset_ms ? Math.round(opts.thumb_offset_ms) : undefined,
      },
      source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
    });

    const handle = await fs.open(file, 'r');
    try {
      for (let i = 0; i < count; i++) {
        const start = i * chunkSize;
        const end = i === count - 1 ? size : start + chunkSize;
        const buf = Buffer.alloc(end - start);
        await handle.read(buf, 0, buf.length, start);
        let res;
        try {
          res = await ctx.fetch(init.upload_url, {
            method: 'PUT',
            headers: { 'Content-Type': video.mime, 'Content-Length': String(buf.length), 'Content-Range': `bytes ${start}-${end - 1}/${size}` },
            body: buf,
            signal: AbortSignal.timeout(300_000),
          });
        } catch (err) {
          throw networkError(err);
        }
        if (!res.ok) throw new PublishError(`Falha ao enviar o vídeo ao TikTok (parte ${i + 1}/${count}, HTTP ${res.status}).`, { retryable: res.status >= 500 });
      }
    } finally {
      await handle.close();
    }

    const deadline = ctx.now() + 10 * 60_000;
    for (let delay = 3000; ; delay = Math.min(delay * 1.5, 10_000)) {
      const s = await tiktokCall(ctx.fetch, '/post/publish/status/fetch/', token, { publish_id: init.publish_id });
      if (s.status === 'PUBLISH_COMPLETE') {
        const postId = s.publicaly_available_post_id?.[0];
        return { remoteId: String(postId || init.publish_id), permalink: postId ? `https://www.tiktok.com/@${account.username}/video/${postId}` : null };
      }
      if (s.status === 'FAILED') throw new PublishError(`O TikTok recusou o vídeo: ${s.fail_reason || 'motivo não informado'}.`);
      if (ctx.now() > deadline) {
        ctx.warn('O TikTok ainda está processando o vídeo; ele deve aparecer no perfil em alguns minutos.');
        return { remoteId: init.publish_id, permalink: null };
      }
      await ctx.sleep(delay);
    }
  }

  return { publish };
}
