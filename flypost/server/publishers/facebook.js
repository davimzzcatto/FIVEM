import { graph } from './graph.js';
import { PublishError } from './errors.js';

const REELS_MAX_MS = 90_000;

// Páginas do Facebook. O token salvo na conta é o token da Página.
export function createFacebookPublisher({ config }) {
  const base = `https://graph.facebook.com/${config.graphVersion}`;

  async function publish({ post, account, media, ctx }) {
    const pageId = account.external_id;
    const token = account.accessToken;
    const call = (method, path, params = {}, extra) => graph(ctx.fetch, method, path.startsWith('http') ? path : `${base}/${path}`, { ...params, access_token: token }, extra);
    const link = async (id) => {
      try {
        return (await call('GET', id, { fields: 'permalink_url' })).permalink_url || null;
      } catch {
        return null;
      }
    };

    if (post.type === 'image') {
      const r = await call('POST', `${pageId}/photos`, { url: ctx.publicUrl(media[0]), message: post.caption });
      const id = r.post_id || r.id;
      return { remoteId: id, permalink: await link(id) };
    }

    if (post.type === 'carousel') {
      const attached = {};
      for (const [i, m] of media.entries()) {
        const photo = await call('POST', `${pageId}/photos`, { url: ctx.publicUrl(m), published: 'false' });
        attached[`attached_media[${i}]`] = JSON.stringify({ media_fbid: photo.id });
      }
      const r = await call('POST', `${pageId}/feed`, { message: post.caption, ...attached });
      return { remoteId: r.id, permalink: await link(r.id) };
    }

    // Vídeo: Reels quando cabe nas regras (vertical, até 90s); senão vídeo comum da Página.
    const v = media[0];
    const vertical = !v.width || !v.height || v.height > v.width;
    const fitsReels = vertical && (v.duration_ms == null || v.duration_ms <= REELS_MAX_MS);
    if (!fitsReels) {
      const r = await call('POST', `${pageId}/videos`, { file_url: ctx.publicUrl(v), description: post.caption }, { timeoutMs: 300_000 });
      return { remoteId: r.id, permalink: `https://www.facebook.com/${pageId}/videos/${r.id}` };
    }

    const start = await call('POST', `${pageId}/video_reels`, { upload_phase: 'start' });
    const upload = await graph(ctx.fetch, 'POST', start.upload_url || `https://rupload.facebook.com/video-upload/${config.graphVersion}/${start.video_id}`, {}, {
      headers: { Authorization: `OAuth ${token}`, file_url: ctx.publicUrl(v) },
      timeoutMs: 300_000,
    });
    if (upload.success === false) throw new PublishError('O Facebook não conseguiu baixar o vídeo.', { retryable: true });
    await call('POST', `${pageId}/video_reels`, { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: post.caption });

    const deadline = ctx.now() + 15 * 60_000;
    for (let delay = 3000; ; delay = Math.min(delay * 1.5, 10_000)) {
      const s = (await call('GET', start.video_id, { fields: 'status' })).status || {};
      if (s.video_status === 'ready' || s.publishing_phase?.status === 'complete') break;
      if (s.video_status === 'error' || s.processing_phase?.status === 'error') {
        throw new PublishError(`O Facebook recusou o vídeo: ${s.processing_phase?.error?.message || 'erro no processamento'}.`);
      }
      if (ctx.now() > deadline) break; // segue processando do lado deles; o post já foi enviado
      await ctx.sleep(delay);
    }
    return { remoteId: start.video_id, permalink: `https://www.facebook.com/reel/${start.video_id}` };
  }

  return { publish };
}
