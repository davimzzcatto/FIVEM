import { graph } from './graph.js';
import { PublishError } from './errors.js';

// Instagram API com login do Instagram (graph.instagram.com).
// Fluxo: cria o contêiner de mídia → espera processar → media_publish → primeiro comentário.
export function createInstagramPublisher({ config }) {
  const base = `https://graph.instagram.com/${config.graphVersion}`;

  async function publish({ post, account, media, ctx }) {
    const igId = account.external_id;
    const call = (method, path, params = {}) => graph(ctx.fetch, method, `${base}/${path}`, { ...params, access_token: account.accessToken });
    const opts = post.options || {};
    const hasVideo = media.some((m) => m.kind === 'video');

    let containerId;
    if (post.type === 'carousel') {
      const children = [];
      for (const m of media) {
        const params = m.kind === 'video' ? { media_type: 'VIDEO', video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) };
        children.push((await call('POST', `${igId}/media`, { ...params, is_carousel_item: 'true' })).id);
      }
      for (const id of children) await waitReady(call, ctx, id, hasVideo);
      containerId = (await call('POST', `${igId}/media`, { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption })).id;
    } else if (post.type === 'reels') {
      containerId = (
        await call('POST', `${igId}/media`, {
          media_type: 'REELS',
          video_url: ctx.publicUrl(media[0]),
          caption: post.caption,
          share_to_feed: opts.share_to_feed === false ? 'false' : 'true',
          cover_url: opts.cover ? ctx.publicUrl(opts.cover) : undefined,
          thumb_offset: !opts.cover && opts.thumb_offset_ms ? Math.round(opts.thumb_offset_ms) : undefined,
        })
      ).id;
    } else if (post.type === 'story') {
      const m = media[0];
      const params = m.kind === 'video' ? { video_url: ctx.publicUrl(m) } : { image_url: ctx.publicUrl(m) };
      containerId = (await call('POST', `${igId}/media`, { media_type: 'STORIES', ...params })).id;
    } else {
      containerId = (await call('POST', `${igId}/media`, { image_url: ctx.publicUrl(media[0]), caption: post.caption })).id;
    }

    await waitReady(call, ctx, containerId, hasVideo);

    let mediaId;
    try {
      mediaId = (await call('POST', `${igId}/media_publish`, { creation_id: containerId })).id;
    } catch (err) {
      // Se a rede caiu aqui, o post pode ter saído. Repetir sozinho arriscaria publicar duas vezes.
      if (err.retryable && /rede/i.test(err.message)) {
        throw new PublishError('Não deu para confirmar a publicação. Confira o perfil antes de tentar de novo.');
      }
      throw err;
    }

    let permalink = null;
    try {
      permalink = (await call('GET', mediaId, { fields: 'permalink' })).permalink || null;
    } catch {
      /* o post saiu; o link é só conveniência */
    }

    if (post.first_comment && post.type !== 'story') {
      try {
        await call('POST', `${mediaId}/comments`, { message: post.first_comment });
      } catch (err) {
        ctx.warn(`Post publicado, mas o primeiro comentário falhou: ${err.message}`);
      }
    }
    return { remoteId: mediaId, permalink };
  }

  return { publish };
}

async function waitReady(call, ctx, id, isVideo) {
  const deadline = ctx.now() + (isVideo ? 15 : 2) * 60_000;
  let delay = 1500;
  for (;;) {
    const { status_code: code, status } = await call('GET', id, { fields: 'status_code,status' });
    if (code === 'FINISHED' || code === 'PUBLISHED') return;
    if (code === 'ERROR') throw new PublishError(`O Instagram recusou a mídia: ${status || 'erro no processamento'}.`);
    if (code === 'EXPIRED') throw new PublishError('O contêiner de mídia expirou antes da publicação.', { retryable: true });
    if (ctx.now() > deadline) throw new PublishError('O Instagram demorou demais para processar a mídia.', { retryable: true });
    await ctx.sleep(delay);
    delay = Math.min(delay * 1.5, 8000);
  }
}
