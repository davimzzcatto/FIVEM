import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import { startApp, mp4 } from './helpers.js';

const MIN = 60_000;

// Recebe webhooks de verdade numa porta local e guarda o que chegou.
async function webhookSink() {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body, json: JSON.parse(body) });
      res.end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/hook`, got, close: () => new Promise((r) => server.close(r)) };
}

async function setup() {
  const clock = { t: Date.now() };
  const ctx = await startApp({ clock });
  const c = ctx.client();
  await c.signup('fila@exemplo.com');
  const ws = (await c.get('/api/workspaces')).data[0];
  const acc = (await c.post('/api/accounts/simulated', { workspace_id: ws.id, platform: 'instagram', username: 'loja' })).data;
  const vid = (await c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const schedule = async (caption, at = clock.t + 5 * MIN, extra = {}) =>
    (await c.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], caption, scheduled_at: at, ...extra })).data.ids[0];
  const run = async () => {
    await ctx.app.scheduler.tick();
    await ctx.app.scheduler.idle();
    await ctx.app.events.settle();
  };
  return { ctx, c, ws, acc, vid, clock, schedule, run };
}

test('publica na hora certa, registra no histórico e avisa o webhook assinado', async () => {
  const { ctx, c, clock, schedule, run } = await setup();
  const sink = await webhookSink();
  const hook = (await c.post('/api/webhooks', { url: sink.url, events: ['post.published', 'post.failed'] })).data;
  try {
    const id = await schedule('Olá', clock.t + 10 * MIN, { first_comment: '#tag' });
    await run();
    assert.equal((await c.get(`/api/posts/${id}`)).data.status, 'scheduled', 'ainda não é hora');

    clock.t += 11 * MIN;
    await run();
    const post = (await c.get(`/api/posts/${id}`)).data;
    assert.equal(post.status, 'published');
    assert.match(post.remote_id, /^sim_/);

    const logs = (await c.get('/api/logs')).data;
    assert.ok(logs.some((l) => l.event === 'post.published' && l.post_id === id));
    assert.ok(logs.some((l) => /Primeiro comentário/.test(l.message)));

    assert.equal(sink.got.length, 1);
    const [delivery] = sink.got;
    assert.equal(delivery.json.event, 'post.published');
    assert.equal(delivery.json.data.post_id, id);
    const expected = 'sha256=' + crypto.createHmac('sha256', hook.secret).update(delivery.body).digest('hex');
    assert.equal(delivery.headers['x-flypost-signature'], expected);
  } finally {
    await sink.close();
    await ctx.close();
  }
});

test('falha temporária volta para a fila com espera; falha definitiva para', async () => {
  const { ctx, c, clock, schedule, run } = await setup();
  try {
    const flaky = await schedule('oi [instavel]');
    const broken = await schedule('oi [falhar]');
    clock.t += 6 * MIN;
    await run();

    let p = (await c.get(`/api/posts/${flaky}`)).data;
    assert.equal(p.status, 'scheduled');
    assert.equal(p.attempts, 1);
    assert.equal(p.next_attempt_at, clock.t + MIN);
    assert.match(p.last_error, /Instabilidade simulada/);
    assert.equal((await c.get(`/api/posts/${broken}`)).data.status, 'failed');

    await run();
    assert.equal((await c.get(`/api/posts/${flaky}`)).data.status, 'scheduled', 'respeita a espera');

    clock.t += MIN + 1;
    await run();
    p = (await c.get(`/api/posts/${flaky}`)).data;
    assert.equal(p.status, 'published');
    assert.equal(p.attempts, 2);
    assert.equal(p.last_error, null);

    // "Tentar de novo" zera as tentativas e publica na hora (aqui falha de novo, por causa do [falhar])
    assert.equal((await c.post(`/api/posts/${broken}/retry`)).status, 200);
    await new Promise((r) => setImmediate(r));
    await run();
    const again = (await c.get(`/api/posts/${broken}`)).data;
    assert.equal(again.status, 'failed');
    assert.equal(again.attempts, 1);
    const fails = (await c.get(`/api/logs?post_id=${broken}`)).data.filter((l) => l.event === 'post.failed');
    assert.equal(fails.length, 2);
  } finally {
    await ctx.close();
  }
});

test('conta desativada segura o post por 1h e depois ele falha', async () => {
  const { ctx, c, acc, clock, schedule, run } = await setup();
  try {
    const id = await schedule('x');
    await c.patch(`/api/accounts/${acc.id}`, { status: 'disabled' });
    clock.t += 30 * MIN;
    await run();
    assert.equal((await c.get(`/api/posts/${id}`)).data.status, 'scheduled');
    clock.t += 40 * MIN;
    await run();
    const p = (await c.get(`/api/posts/${id}`)).data;
    assert.equal(p.status, 'failed');
    assert.match(p.last_error, /desativada/);
  } finally {
    await ctx.close();
  }
});

test('post que ficou "publicando" quando o servidor caiu vira falha no boot', async () => {
  const { ctx, c, clock, schedule } = await setup();
  try {
    const id = await schedule('x');
    ctx.app.db.run("UPDATE posts SET status = 'publishing', locked_at = ? WHERE id = ?", clock.t, id);
    ctx.app.scheduler.start();
    await ctx.app.scheduler.stop();
    const p = (await c.get(`/api/posts/${id}`)).data;
    assert.equal(p.status, 'failed');
    assert.match(p.last_error, /interrompida/);
  } finally {
    await ctx.close();
  }
});

test('publicar agora e cancelar um lote', async () => {
  const { ctx, c, acc, vid, clock, run } = await setup();
  try {
    const now = await c.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], caption: 'já', publish_now: true });
    assert.equal(now.status, 201);
    await run();
    assert.equal((await c.get(`/api/posts/${now.data.ids[0]}`)).data.status, 'published');

    const batch = await c.post('/api/posts/batch', {
      account_ids: [acc.id],
      type: 'reels',
      items: [1, 2, 3].map((i) => ({ media_ids: [vid.id], caption: `${i}`, scheduled_at: clock.t + i * 60 * MIN })),
    });
    const r = await c.post(`/api/batches/${batch.data.batch_id}/cancel`);
    assert.equal(r.data.canceled, 3);
    // cancelados não contam no limite do mês
    assert.equal((await c.get('/api/me')).data.usage.used, 1);
  } finally {
    await ctx.close();
  }
});
