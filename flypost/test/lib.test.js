import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spin, spinMany, countVariations, hasSpintax } from '../public/lib/spintax.js';
import { fixedSlots, intervalSlots, normalizeTimes } from '../public/lib/slots.js';
import { validatePost, maxInWindow, hashtagCount } from '../public/lib/rules.js';
import { monthRange } from '../server/plans.js';
import { imageSize } from '../server/media.js';
import { planChunks } from '../server/publishers/tiktok.js';
import { png, jpeg } from './helpers.js';

test('spintax sorteia, conta e aninha', () => {
  assert.equal(countVariations('{a|b} e {c|d|e}'), 6);
  assert.equal(countVariations('{Oi|Olá {pessoal|gente}}'), 3);
  assert.equal(spin('{a|b}', () => 0), 'a');
  assert.equal(spin('{a|b}', () => 0.99), 'b');
  assert.equal(spin('{Oi|Olá {pessoal|gente}}!', () => 0.99), 'Olá gente!');
  assert.ok(hasSpintax('x {a|b}'));
  assert.ok(!hasSpintax('só texto'));
});

test('spintax deixa chaves sem barra e sem fechamento como texto', () => {
  assert.equal(spin('preço {promo} hoje'), 'preço {promo} hoje');
  assert.equal(spin('abre { e não fecha'), 'abre { e não fecha');
  assert.equal(spin('{a|b'), '{a|b');
  assert.equal(spin('json {"x":1}'), 'json {"x":1}');
});

test('spinMany não repete enquanto houver combinação nova', () => {
  const out = spinMany('{a|b|c}', 3);
  assert.equal(new Set(out).size, 3);
  assert.equal(spinMany('{a|b}', 5).length, 5);
});

test('horários fixos pulam o passado e respeitam posts por dia e dias da semana', () => {
  const now = new Date(2026, 9, 8, 10, 0).getTime(); // qui 08/10 10:00
  const slots = fixedSlots({ count: 5, startDate: '2026-10-08', times: ['18:00', '09:00', '12:00'], now });
  const hours = slots.map((t) => `${new Date(t).getDate()} ${new Date(t).getHours()}`);
  assert.deepEqual(hours, ['8 12', '8 18', '9 9', '9 12', '9 18']);

  const perDay = fixedSlots({ count: 3, startDate: '2026-10-09', times: ['09:00', '12:00', '18:00'], perDay: 1, now });
  assert.deepEqual(perDay.map((t) => new Date(t).getDate()), [9, 10, 11]);

  const weekdays = fixedSlots({ count: 2, startDate: '2026-10-09', times: ['09:00'], weekdays: [1], now }); // só segundas
  assert.deepEqual(weekdays.map((t) => new Date(t).getDay()), [1, 1]);
  assert.deepEqual(normalizeTimes(['9:00', '09:00', '25:00', '07:30']), ['07:30', '09:00']);
});

test('intervalo pula para a janela do dia seguinte', () => {
  const now = new Date(2026, 9, 8, 8, 0).getTime();
  const start = new Date(2026, 9, 8, 20, 0).getTime();
  const slots = intervalSlots({ count: 4, start, everyMinutes: 60, windowStart: '09:00', windowEnd: '21:00', now });
  assert.deepEqual(
    slots.map((t) => `${new Date(t).getDate()} ${new Date(t).getHours()}`),
    ['8 20', '8 21', '9 9', '9 10'],
  );
});

test('regras de cada rede', () => {
  const video = { kind: 'video', width: 1080, height: 1920, duration_ms: 15_000 };
  const img = (w, h) => ({ kind: 'image', width: w, height: h });
  assert.deepEqual(validatePost({ platform: 'instagram', type: 'reels', media: [video] }), []);
  assert.match(validatePost({ platform: 'tiktok', type: 'image', media: [img(1080, 1080)] })[0], /TikTok não aceita/);
  assert.match(validatePost({ platform: 'instagram', type: 'image', media: [img(1080, 400)] })[0], /proporção/);
  assert.deepEqual(validatePost({ platform: 'facebook', type: 'image', media: [img(1080, 400)] }), []);
  assert.match(validatePost({ platform: 'facebook', type: 'carousel', media: [img(1, 1), video] }).join(), /só imagens/);
  assert.match(validatePost({ platform: 'instagram', type: 'carousel', media: [img(1, 1)] })[0], /pelo menos 2/);
  assert.match(validatePost({ platform: 'instagram', type: 'reels', media: [{ ...video, duration_ms: 1000 }] })[0], /curto/);
  const tags = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(' ');
  assert.equal(hashtagCount(tags), 31);
  assert.match(validatePost({ platform: 'instagram', type: 'reels', media: [video], caption: tags }).join(), /30 hashtags/);
});

test('janela móvel de 24h', () => {
  const H = 3_600_000;
  assert.equal(maxInWindow([0, H, 2 * H, 25 * H, 26 * H]), 3);
  assert.equal(maxInWindow([0, 24 * H]), 1);
  assert.equal(maxInWindow([]), 0);
});

test('limites do mês no fuso do usuário', () => {
  // 01/11 01:00 em UTC ainda é 31/10 em São Paulo.
  const at = Date.UTC(2026, 10, 1, 1, 0);
  const r = monthRange(at, 'America/Sao_Paulo');
  assert.equal(r.key, '2026-10');
  assert.equal(r.start, Date.UTC(2026, 9, 1, 3, 0));
  assert.equal(r.end, Date.UTC(2026, 10, 1, 3, 0));
});

test('lê dimensões de PNG e JPEG pelo cabeçalho', () => {
  assert.deepEqual(imageSize(png(30, 20)), { width: 30, height: 20 });
  assert.deepEqual(imageSize(jpeg(1080, 1350)), { width: 1080, height: 1350 });
});

test('partes do upload do TikTok seguem as regras de tamanho', () => {
  const MB = 1024 * 1024;
  assert.deepEqual(planChunks(3 * MB), { chunkSize: 3 * MB, count: 1 });
  assert.deepEqual(planChunks(64 * MB), { chunkSize: 64 * MB, count: 1 });
  const big = planChunks(105 * MB + 123);
  assert.equal(big.chunkSize, 10 * MB);
  assert.equal(big.count, 10);
  // a última parte absorve a sobra e continua abaixo de 128 MB
  assert.ok(105 * MB + 123 - big.chunkSize * (big.count - 1) < 128 * MB);
});
