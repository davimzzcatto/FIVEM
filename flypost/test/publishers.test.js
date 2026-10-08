import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInstagramPublisher } from '../server/publishers/instagram.js';
import { createFacebookPublisher } from '../server/publishers/facebook.js';
import { createTiktokPublisher } from '../server/publishers/tiktok.js';
import { createOAuth } from '../server/oauth.js';
import { mockFetch, form } from './helpers.js';

const config = { graphVersion: 'v24.0', publicUrl: 'https://flypost.test', instagram: { appId: 'ig-app', appSecret: 'ig-secret' }, facebook: { appId: 'fb', appSecret: 'fbs' }, tiktok: { clientKey: 'tk', clientSecret: 'tks' } };

function ctxFor(fetch, extra = {}) {
  const notes = [];
  return {
    notes,
    ctx: { fetch, sleep: async () => {}, now: () => 0, publicUrl: (m) => `https://flypost.test/m/${m.file}`, filePath: (m) => m.path, warn: (m) => notes.push(m), info: () => {}, ...extra },
  };
}

const account = { external_id: '1789', accessToken: 'TOKEN', username: 'loja', settings: {} };

test('Instagram: imagem com primeiro comentário', async () => {
  const fetch = mockFetch(
    [
      [/\/1789\/media_publish$/, () => ({ id: 'MEDIA1' })],
      [/\/1789\/media$/, () => ({ id: 'CONT1' })],
      [/\/CONT1\?/, () => ({ status_code: 'FINISHED' })],
      [/\/MEDIA1\/comments$/, () => ({ id: 'C1' })],
      [/\/MEDIA1\?/, () => ({ permalink: 'https://www.instagram.com/p/abc/' })],
    ],
    null,
  );
  const { ctx } = ctxFor(fetch);
  const out = await createInstagramPublisher({ config }).publish({ post: { type: 'image', caption: 'Olá', first_comment: '#tag', options: {} }, account, media: [{ kind: 'image', file: 'a.jpg' }], ctx });
  assert.deepEqual(out, { remoteId: 'MEDIA1', permalink: 'https://www.instagram.com/p/abc/' });

  const [create, , publish, , comment] = fetch.calls;
  assert.equal(create.url, 'https://graph.instagram.com/v24.0/1789/media');
  assert.deepEqual(form(create.body), { image_url: 'https://flypost.test/m/a.jpg', caption: 'Olá', access_token: 'TOKEN' });
  assert.deepEqual(form(publish.body), { creation_id: 'CONT1', access_token: 'TOKEN' });
  assert.deepEqual(form(comment.body), { message: '#tag', access_token: 'TOKEN' });
});

test('Instagram: carrossel cria filhos, espera o vídeo processar e publica', async () => {
  let polls = 0;
  let n = 0;
  const fetch = mockFetch(
    [
      [/\/1789\/media_publish$/, () => ({ id: 'M' })],
      [/\/1789\/media$/, ({ body }) => ({ id: form(body).media_type === 'CAROUSEL' ? 'PARENT' : `CHILD${++n}` })],
      [/\/CHILD2\?/, () => ({ status_code: ++polls < 3 ? 'IN_PROGRESS' : 'FINISHED' })],
      [/\/(CHILD1|PARENT)\?/, () => ({ status_code: 'FINISHED' })],
      [/\/M\?/, () => ({ permalink: null })],
    ],
    null,
  );
  const { ctx } = ctxFor(fetch);
  await createInstagramPublisher({ config }).publish({
    post: { type: 'carousel', caption: 'c', options: {} },
    account,
    media: [
      { kind: 'image', file: '1.jpg' },
      { kind: 'video', file: '2.mp4' },
    ],
    ctx,
  });
  const creates = fetch.calls.filter((c) => c.url.endsWith('/1789/media')).map((c) => form(c.body));
  assert.equal(creates[0].is_carousel_item, 'true');
  assert.equal(creates[1].media_type, 'VIDEO');
  assert.deepEqual([creates[2].media_type, creates[2].children], ['CAROUSEL', 'CHILD1,CHILD2']);
  assert.equal(polls, 3);
});

test('Instagram: Reels com capa por frame e sem aparecer no feed', async () => {
  const fetch = mockFetch(
    [
      [/media_publish$/, () => ({ id: 'M' })],
      [/\/media$/, () => ({ id: 'R' })],
      [/\/R\?/, () => ({ status_code: 'FINISHED' })],
      [/\/M\?/, () => ({ permalink: 'p' })],
    ],
    null,
  );
  const { ctx } = ctxFor(fetch);
  await createInstagramPublisher({ config }).publish({ post: { type: 'reels', caption: 'r', options: { share_to_feed: false, thumb_offset_ms: 1500 } }, account, media: [{ kind: 'video', file: 'v.mp4' }], ctx });
  const p = form(fetch.calls[0].body);
  assert.deepEqual([p.media_type, p.video_url, p.share_to_feed, p.thumb_offset], ['REELS', 'https://flypost.test/m/v.mp4', 'false', '1500']);
});

test('Instagram: erros são classificados (token, limite, recusa)', async () => {
  const pub = createInstagramPublisher({ config });
  const run = (status, error) => pub.publish({ post: { type: 'image', caption: '', options: {} }, account, media: [{ kind: 'image', file: 'a.jpg' }], ctx: ctxFor(mockFetch([[/./, () => ({ status, json: { error } })]], null)).ctx });

  await assert.rejects(run(400, { code: 190, message: 'expired' }), (e) => e.auth && !e.retryable);
  await assert.rejects(run(400, { code: 4, message: 'rate' }), (e) => e.retryable && !e.auth);
  await assert.rejects(run(500, { code: 2, message: 'tmp' }), (e) => e.retryable);
  await assert.rejects(run(400, { code: 100, message: 'Only photo or video can be accepted as media type.' }), (e) => !e.retryable && /photo or video/.test(e.message));

  const errored = mockFetch(
    [
      [/\/media$/, () => ({ id: 'X' })],
      [/\/X\?/, () => ({ status_code: 'ERROR', status: 'Error: 2207026' })],
    ],
    null,
  );
  await assert.rejects(pub.publish({ post: { type: 'reels', caption: '', options: {} }, account, media: [{ kind: 'video', file: 'v.mp4' }], ctx: ctxFor(errored).ctx }), /recusou a mídia/);
});

test('Instagram: queda de rede no media_publish não é repetida sozinha', async () => {
  const fetch = mockFetch(
    [
      [/media_publish$/, () => {
        throw new TypeError('fetch failed');
      }],
      [/\/media$/, () => ({ id: 'C' })],
      [/\/C\?/, () => ({ status_code: 'FINISHED' })],
    ],
    null,
  );
  await assert.rejects(
    createInstagramPublisher({ config }).publish({ post: { type: 'image', caption: '', options: {} }, account, media: [{ kind: 'image', file: 'a.jpg' }], ctx: ctxFor(fetch).ctx }),
    (e) => !e.retryable && /Confira o perfil/.test(e.message),
  );
});

test('Facebook: carrossel sobe as fotos sem publicar e junta no feed', async () => {
  let i = 0;
  const fetch = mockFetch(
    [
      [/\/PAGE\/photos$/, () => ({ id: `P${++i}` })],
      [/\/PAGE\/feed$/, () => ({ id: 'PAGE_POST' })],
      [/\/PAGE_POST\?/, () => ({ permalink_url: 'https://facebook.com/x' })],
    ],
    null,
  );
  const out = await createFacebookPublisher({ config }).publish({
    post: { type: 'carousel', caption: 'Álbum', options: {} },
    account: { external_id: 'PAGE', accessToken: 'PT' },
    media: [
      { kind: 'image', file: '1.jpg' },
      { kind: 'image', file: '2.jpg' },
    ],
    ctx: ctxFor(fetch).ctx,
  });
  assert.deepEqual(out, { remoteId: 'PAGE_POST', permalink: 'https://facebook.com/x' });
  assert.equal(form(fetch.calls[0].body).published, 'false');
  const feed = form(fetch.calls[2].body);
  assert.equal(feed.message, 'Álbum');
  assert.equal(feed['attached_media[1]'], '{"media_fbid":"P2"}');
});

test('Facebook: vídeo horizontal vai como vídeo comum; vertical curto vai como Reels', async () => {
  const fetch = mockFetch(
    [
      [/\/PAGE\/videos$/, () => ({ id: 'V1' })],
      [/\/PAGE\/video_reels$/, ({ body }) => (form(body).upload_phase === 'start' ? { video_id: 'R1', upload_url: 'https://rupload.facebook.com/video-upload/v24.0/R1' } : { success: true })],
      [/rupload/, () => ({ success: true })],
      [/\/R1\?/, () => ({ status: { video_status: 'ready' } })],
    ],
    null,
  );
  const pub = createFacebookPublisher({ config });
  const acc = { external_id: 'PAGE', accessToken: 'PT' };
  const wide = await pub.publish({ post: { type: 'reels', caption: 'v', options: {} }, account: acc, media: [{ kind: 'video', file: 'w.mp4', width: 1920, height: 1080, duration_ms: 30_000 }], ctx: ctxFor(fetch).ctx });
  assert.equal(wide.remoteId, 'V1');
  const reel = await pub.publish({ post: { type: 'reels', caption: 'r', options: {} }, account: acc, media: [{ kind: 'video', file: 'r.mp4', width: 1080, height: 1920, duration_ms: 30_000 }], ctx: ctxFor(fetch).ctx });
  assert.equal(reel.permalink, 'https://www.facebook.com/reel/R1');
  const upload = fetch.calls.find((c) => c.url.includes('rupload'));
  assert.equal(upload.headers.file_url, 'https://flypost.test/m/r.mp4');
  assert.equal(upload.headers.Authorization, 'OAuth PT');
});

test('TikTok: consulta o criador, sobe o vídeo em partes e confere o status', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-tt-'));
  const file = path.join(dir, 'v.mp4');
  fs.writeFileSync(file, Buffer.alloc(70 * 1024 * 1024, 1)); // 70 MB → 7 partes de 10 MB
  let polls = 0;
  const fetch = mockFetch(
    [
      [/creator_info/, () => ({ data: { privacy_level_options: ['SELF_ONLY', 'FOLLOWER_OF_CREATOR'], max_video_post_duration_sec: 600 }, error: { code: 'ok' } })],
      [/video\/init/, () => ({ data: { publish_id: 'PUB1', upload_url: 'https://upload.tiktok.test/u' }, error: { code: 'ok' } })],
      [/upload\.tiktok\.test/, () => ({ status: 201, json: {} })],
      [/status\/fetch/, () => ({ data: ++polls < 2 ? { status: 'PROCESSING_UPLOAD' } : { status: 'PUBLISH_COMPLETE', publicaly_available_post_id: [7123] }, error: { code: 'ok' } })],
    ],
    null,
  );
  const { ctx, notes } = ctxFor(fetch);
  try {
    const out = await createTiktokPublisher().publish({
      post: { type: 'reels', caption: 'dança', options: { tiktok_privacy: 'PUBLIC_TO_EVERYONE' } },
      account: { ...account, accessToken: 'TT' },
      media: [{ kind: 'video', mime: 'video/mp4', path: file, duration_ms: 20_000 }],
      ctx,
    });
    assert.deepEqual(out, { remoteId: '7123', permalink: 'https://www.tiktok.com/@loja/video/7123' });

    const init = JSON.parse(fetch.calls[1].body);
    assert.equal(init.post_info.privacy_level, 'SELF_ONLY', 'cai para uma opção permitida');
    assert.deepEqual(init.source_info, { source: 'FILE_UPLOAD', video_size: 70 * 1024 * 1024, chunk_size: 10 * 1024 * 1024, total_chunk_count: 7 });
    assert.match(notes[0], /não disponível/);

    const puts = fetch.calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 7);
    assert.equal(puts[0].headers['Content-Range'], `bytes 0-${10 * 1024 * 1024 - 1}/${70 * 1024 * 1024}`);
    assert.equal(puts[6].headers['Content-Range'], `bytes ${60 * 1024 * 1024}-${70 * 1024 * 1024 - 1}/${70 * 1024 * 1024}`);
    assert.equal(fetch.calls[0].headers.Authorization, 'Bearer TT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TikTok: token inválido vira erro de autenticação', async () => {
  const fetch = mockFetch([[/creator_info/, () => ({ status: 401, json: { error: { code: 'access_token_invalid', message: 'bad' } } })]], null);
  await assert.rejects(createTiktokPublisher().publish({ post: { type: 'reels', caption: '', options: {} }, account, media: [{ kind: 'video' }], ctx: ctxFor(fetch).ctx }), (e) => e.auth);
});

test('OAuth do Instagram: troca o código por token longo e lê o perfil', async () => {
  const fetch = mockFetch(
    [
      ['api.instagram.com/oauth/access_token', ({ body }) => (assert.equal(form(body).code, 'CODE'), { access_token: 'SHORT', user_id: 1789 })],
      ['graph.instagram.com/access_token', ({ url }) => (assert.equal(url.searchParams.get('grant_type'), 'ig_exchange_token'), { access_token: 'LONG', expires_in: 5_184_000 })],
      ['/me?', () => ({ user_id: '1789', username: 'loja', name: 'Loja', profile_picture_url: 'https://cdn/x.jpg' })],
    ],
    null,
  );
  const oauth = createOAuth({ config, fetch, now: () => 1000 });
  const url = new URL(oauth.instagram.authorizeUrl('STATE'));
  assert.equal(url.searchParams.get('redirect_uri'), 'https://flypost.test/oauth/instagram/callback');
  assert.match(url.searchParams.get('scope'), /instagram_business_content_publish/);
  const [p] = await oauth.instagram.exchange('CODE#_');
  assert.deepEqual([p.external_id, p.username, p.access_token, p.token_expires_at], ['1789', 'loja', 'LONG', 1000 + 5_184_000_000]);
  assert.equal(oauth.instagram.needsRefresh({ token_expires_at: 1000 + 10 * 86_400_000, token_issued_at: 0 }), false, 'token com menos de 24h não renova');
});
