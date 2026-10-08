import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, png, jpeg, mp4 } from './helpers.js';

const HOUR = 3_600_000;
let ctx;
before(async () => {
  ctx = await startApp();
});
after(() => ctx.close());

async function userWithAccount(email, platform = 'instagram') {
  const c = ctx.client();
  await c.signup(email);
  const ws = (await c.get('/api/workspaces')).data[0];
  const acc = (await c.post('/api/accounts/simulated', { workspace_id: ws.id, platform, username: `${platform}_${email.split('@')[0]}` })).data;
  return { c, ws, acc };
}

test('cadastro, sessão, login e logout', async () => {
  const c = ctx.client();
  await c.signup('login@exemplo.com', 'Bia');
  const me = await c.get('/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.data.user.name, 'Bia');
  assert.equal(me.data.plan.id, 'teste');
  assert.equal((await c.post('/api/auth/logout')).status, 200);
  assert.equal((await c.get('/api/me')).status, 401);

  assert.equal((await c.post('/api/auth/login', { email: 'login@exemplo.com', password: 'errada' })).status, 401);
  assert.equal((await c.post('/api/auth/login', { email: 'LOGIN@exemplo.com', password: 'senha-forte-1' })).status, 200);
  assert.equal((await c.get('/api/me')).status, 200);

  const dup = await ctx.client().post('/api/auth/signup', { name: 'X', email: 'login@exemplo.com', password: 'senha-forte-1' });
  assert.equal(dup.status, 409);
});

test('alterações exigem o cabeçalho anti-CSRF quando a sessão vem de cookie', async () => {
  const c = ctx.client();
  await c.signup('csrf@exemplo.com');
  const ws = (await c.get('/api/workspaces')).data[0];
  const cookie = (await fetch(`${ctx.base}/api/auth/login`, { method: 'POST', headers: { 'X-FlyPost': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'csrf@exemplo.com', password: 'senha-forte-1' }) })).headers
    .getSetCookie()[0]
    .split(';')[0];
  const res = await fetch(`${ctx.base}/api/accounts/simulated`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ workspace_id: ws.id, platform: 'instagram' }) });
  assert.equal(res.status, 403);
});

test('upload identifica formato e dimensões e recusa o que não é mídia', async () => {
  const { c } = await userWithAccount('upload@exemplo.com');
  const p = await c.put('/api/media?name=a.png', png(40, 50), { 'Content-Type': 'image/png' });
  assert.equal(p.status, 201);
  assert.deepEqual([p.data.kind, p.data.width, p.data.height], ['image', 40, 50]);
  const j = await c.put('/api/media?name=b.jpg', jpeg(1080, 1350), { 'Content-Type': 'application/octet-stream' });
  assert.equal(j.data.mime, 'image/jpeg');
  const v = await c.put('/api/media?name=c.mp4&width=1080&height=1920&duration_ms=12000', mp4(), { 'Content-Type': 'video/mp4' });
  assert.equal(v.data.kind, 'video');
  const bad = await c.put('/api/media?name=x.txt', Buffer.from('olá'), { 'Content-Type': 'text/plain' });
  assert.equal(bad.status, 400);

  // A mídia é servida publicamente pelo nome aleatório, com suporte a Range.
  const r = await fetch(`${ctx.base}${p.data.url}`, { headers: { Range: 'bytes=0-7' } });
  assert.equal(r.status, 206);
  assert.equal(Buffer.from(await r.arrayBuffer()).readUInt32BE(0), 0x89504e47);
});

test('lote valida regras, horário e cria um post por item em cada conta', async () => {
  const { c, ws, acc } = await userWithAccount('lote@exemplo.com');
  const tt = (await c.post('/api/accounts/simulated', { workspace_id: ws.id, platform: 'tiktok', username: 'tt' })).data;
  const vid = (await c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const wide = (await c.put('/api/media?name=w.jpg', jpeg(1080, 400))).data;
  const t = Date.now() + HOUR;

  const ok = await c.post('/api/posts/batch', { account_ids: [acc.id, tt.id], type: 'reels', spintax: true, items: [{ media_ids: [vid.id], caption: '{a|b}', scheduled_at: t }, { media_ids: [vid.id], caption: 'c', scheduled_at: new Date(t + HOUR).toISOString() }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.created, 4);
  const listed = (await c.get(`/api/posts?batch_id=${ok.data.batch_id}`)).data;
  assert.equal(listed.length, 4);
  const first = listed.filter((p) => p.scheduled_at === t).map((p) => p.caption);
  assert.deepEqual(first.sort(), ['a', 'b']);
  assert.equal(listed.at(-1).scheduled_at, t + HOUR);

  const tooWide = await c.post('/api/posts', { account_ids: [acc.id], type: 'image', media_ids: [wide.id], scheduled_at: t });
  assert.equal(tooWide.status, 422);
  assert.match(tooWide.data.error, /proporção/);

  const past = await c.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: Date.now() - 10 * 60_000 });
  assert.equal(past.status, 422);
  assert.match(past.data.error, /já passou/);

  const wrongType = await c.post('/api/posts', { account_ids: [tt.id], type: 'carousel', media_ids: [vid.id, vid.id], scheduled_at: t });
  assert.match(wrongType.data.error, /TikTok não aceita/);

  const dry = await c.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: t, dry_run: true });
  assert.equal(dry.data.created, 0);
});

test('limite do plano no mês e teto de 24h por conta', async () => {
  const { c } = await userWithAccount('limite@exemplo.com', 'tiktok');
  const tt = (await c.get('/api/accounts')).data[0];
  const vid = (await c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const base = Date.now() + HOUR;

  // 16 posts em menos de 24h no TikTok passam do teto de 15.
  const crowded = Array.from({ length: 16 }, (_, i) => ({ media_ids: [vid.id], caption: `${i}`, scheduled_at: base + i * 60_000 }));
  const r = await c.post('/api/posts/batch', { account_ids: [tt.id], type: 'reels', items: crowded });
  assert.equal(r.status, 422);
  assert.match(r.data.error, /15 posts em 24h/);

  // 12 em 24h passa, com aviso de alcance.
  const fine = await c.post('/api/posts/batch', { account_ids: [tt.id], type: 'reels', items: crowded.slice(0, 12) });
  assert.equal(fine.status, 201);
  assert.ok(fine.data.warnings.some((w) => /alcance/.test(w)));

  assert.equal((await c.get('/api/me')).data.usage.used, 12);
});

test('o plano Teste para em 30 posts no mês', async () => {
  const { c, acc } = await userWithAccount('mensal@exemplo.com');
  const vid = (await c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const base = Date.now() + 10 * 60_000;
  const items = (n) => Array.from({ length: n }, (_, i) => ({ media_ids: [vid.id], caption: `${i}`, scheduled_at: base + i * 60_000 }));
  const over = await c.post('/api/posts/batch', { account_ids: [acc.id], type: 'reels', items: items(31) });
  assert.equal(over.status, 422);
  assert.match(over.data.error, /Limite do plano Teste/);
  const ok = await c.post('/api/posts/batch', { account_ids: [acc.id], type: 'reels', items: items(30) });
  assert.equal(ok.status, 201);
  const me = (await c.get('/api/me')).data;
  assert.deepEqual([me.usage.used, me.usage.limit], [30, 30]);
});

test('editar, cancelar e excluir um post', async () => {
  const { c, acc } = await userWithAccount('editar@exemplo.com');
  const vid = (await c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const t = Date.now() + 5 * HOUR;
  const id = (await c.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], caption: 'antes', scheduled_at: t })).data.ids[0];

  const edited = await c.patch(`/api/posts/${id}`, { caption: 'depois', scheduled_at: t + HOUR });
  assert.equal(edited.status, 200);
  assert.equal(edited.data.post.caption, 'depois');
  assert.equal(edited.data.post.scheduled_at, t + HOUR);

  assert.equal((await c.post(`/api/posts/${id}/cancel`)).status, 200);
  assert.equal((await c.get(`/api/posts/${id}`)).data.status, 'canceled');
  assert.equal((await c.patch(`/api/posts/${id}`, { caption: 'x' })).status, 400);
  assert.equal((await c.del(`/api/posts/${id}`)).status, 200);
  assert.equal((await c.get(`/api/posts/${id}`)).status, 404);
});

test('um usuário não enxerga nem mexe nos dados de outro', async () => {
  const a = await userWithAccount('dono@exemplo.com');
  const b = await userWithAccount('intruso@exemplo.com');
  const vid = (await a.c.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const id = (await a.c.post('/api/posts', { account_ids: [a.acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: Date.now() + HOUR })).data.ids[0];

  assert.equal((await b.c.get(`/api/posts/${id}`)).status, 404);
  assert.equal((await b.c.del(`/api/posts/${id}`)).status, 404);
  assert.equal((await b.c.get('/api/posts')).data.length, 0);
  assert.equal((await b.c.del(`/api/accounts/${a.acc.id}`)).status, 404);
  // conta de outro usuário não entra no lote, nem mídia de outro usuário
  assert.equal((await b.c.post('/api/posts', { account_ids: [a.acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: Date.now() + HOUR })).status, 400);
  const own = await b.c.post('/api/posts', { account_ids: [b.acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: Date.now() + HOUR });
  assert.equal(own.status, 422);
  assert.match(own.data.error, /mídia não encontrada/);
});

test('chave de API autentica sem cookie e marca a origem', async () => {
  const { c, acc } = await userWithAccount('api@exemplo.com');
  const key = (await c.post('/api/keys', { name: 'n8n' })).data;
  assert.match(key.secret, /^fp_live_/);

  const bot = ctx.client();
  bot.useKey(key.secret);
  assert.equal((await bot.get('/api/accounts')).data[0].id, acc.id);
  const vid = (await bot.put('/api/media?name=v.mp4&width=1080&height=1920&duration_ms=9000', mp4(), { 'Content-Type': 'video/mp4' })).data;
  const created = await bot.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: '2099-01-01T12:00:00Z' });
  assert.equal(created.status, 422, 'mais de um ano à frente é recusado');
  const ok = await bot.post('/api/posts', { account_ids: [acc.id], type: 'reels', media_ids: [vid.id], scheduled_at: new Date(Date.now() + HOUR).toISOString() });
  assert.equal(ok.status, 201);
  assert.equal((await bot.get(`/api/posts/${ok.data.ids[0]}`)).data.source, 'api');
  assert.equal((await bot.post('/api/keys', { name: 'outra' })).status, 400);

  await c.del(`/api/keys/${key.id}`);
  assert.equal((await bot.get('/api/accounts')).status, 401);
});

test('plano limita marcas e contas', async () => {
  const c = ctx.client();
  await c.signup('plano@exemplo.com');
  assert.equal((await c.post('/api/workspaces', { name: 'Segunda' })).status, 403);
  const ws = (await c.get('/api/workspaces')).data[0];
  for (let i = 0; i < 3; i++) assert.equal((await c.post('/api/accounts/simulated', { workspace_id: ws.id, platform: 'instagram', username: `c${i}` })).status, 201);
  assert.equal((await c.post('/api/accounts/simulated', { workspace_id: ws.id, platform: 'instagram', username: 'c4' })).status, 403);
  assert.equal((await c.del(`/api/workspaces/${ws.id}`)).status, 400, 'a última marca não pode ser apagada');
});

test('oauth sem credenciais configuradas explica o que falta', async () => {
  const c = ctx.client();
  await c.signup('oauth@exemplo.com');
  const ws = (await c.get('/api/workspaces')).data[0];
  const r = await c.get(`/api/oauth/instagram/start?workspace_id=${ws.id}`);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /não foi configurada/);
});

test('arquivos estáticos e proteção contra path traversal', async () => {
  const index = await fetch(`${ctx.base}/`);
  assert.equal(index.status, 200);
  assert.match(await index.text(), /FlyPost/);
  assert.equal((await fetch(`${ctx.base}/lib/rules.js`)).status, 200);
  assert.equal((await fetch(`${ctx.base}/..%2Fserver%2Fconfig.js`)).status, 404);
  assert.equal((await fetch(`${ctx.base}/m/..%2Fflypost.db`)).status, 404);
});
