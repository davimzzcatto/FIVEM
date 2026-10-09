import { api } from '../api.js';
import { store } from '../store.js';
import { h, clear, icon, fmt, loading, platformIcon, PLATFORM_LABEL } from '../ui.js';
import { TYPES } from '../../lib/rules.js';

const SVG = 'http://www.w3.org/2000/svg';
const DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}

function niceMax(v) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

// Retângulo com a ponta de cima arredondada (4px) e a base reta, como pede a especificação das colunas.
function topRounded(x, y, w, hgt, r) {
  r = Math.min(r, w / 2, hgt);
  return `M${x},${y + hgt}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + hgt}Z`;
}

const dayLabel = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export async function render(root) {
  const state = { days: 30, workspace: '' };
  const body = h('div', loading());
  const period = h('div', { class: 'segmented' });
  const ws = h(
    'select',
    { class: 'input', style: { width: 'auto' }, 'aria-label': 'Marca', onchange: (e) => ((state.workspace = e.target.value), load()) },
    h('option', { value: '' }, 'Todas as marcas'),
    store.workspaces.map((w) => h('option', { value: String(w.id) }, w.name)),
  );

  function paintPeriod() {
    clear(period, [7, 30, 90].map((d) => h('button', { class: state.days === d ? 'on' : '', onclick: () => ((state.days = d), paintPeriod(), load()) }, `${d} dias`)));
  }

  root.append(
    h('div', { class: 'page-head' }, h('div', h('h1', 'Análises'), h('p', 'Volume, taxa de sucesso e quando seus posts vão ao ar.')), h('div', { class: 'actions' }, store.workspaces.length > 1 ? ws : null, period)),
    body,
  );

  async function load() {
    clear(body, loading());
    try {
      const d = await api.get('/api/analytics', { days: state.days, workspace_id: state.workspace });
      clear(body, ...paint(d));
    } catch (err) {
      clear(body, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, err.message)));
    }
  }

  paintPeriod();
  await load();
}

function paint(d) {
  const t = d.totals;
  const tile = (label, value, foot) => h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value', style: { fontVariantNumeric: 'normal' } }, value), foot ? h('div', { class: 'foot' }, foot) : null);
  return [
    h(
      'div',
      { class: 'grid grid-4', style: { marginBottom: '16px' } },
      tile('Publicados', fmt.number(t.published), `nos últimos ${d.days} dias`),
      tile('Falhas', fmt.number(t.failed), t.failed ? h('a', { href: '#/historico?aba=falhas' }, 'Ver falhas') : 'nenhuma'),
      tile('Taxa de sucesso', t.successRate == null ? '—' : `${String(t.successRate).replace('.', ',')}%`, 'publicados ÷ (publicados + falhas)'),
      tile('Na fila (7 dias)', fmt.number(t.upcoming7), 'agendados para a próxima semana'),
    ),
    dailyChart(d),
    h(
      'div',
      { class: 'grid grid-2', style: { marginTop: '16px' } },
      breakdown('Por rede', d.byPlatform, (k) => [platformIcon(k), ' ', PLATFORM_LABEL[k] || k]),
      breakdown('Por tipo', d.byType, (k) => TYPES[k]?.label || k),
    ),
    heatmap(d),
  ];
}

function dailyChart(d) {
  const W = 760;
  const H = 240;
  const pad = { l: 36, r: 8, t: 12, b: 26 };
  const iw = W - pad.l - pad.r;
  const ih = H - pad.t - pad.b;
  const max = niceMax(Math.max(1, ...d.perDay.map((p) => p.published + p.failed)));
  const slot = iw / d.perDay.length;
  const bw = Math.max(2, Math.min(24, slot * 0.66));
  const y = (v) => pad.t + ih - (v / max) * ih;
  const GAP = 2;

  const tip = h('div', { class: 'chart-tip', hidden: true });
  const wrap = h('div', { class: 'chart-wrap' });
  const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Publicados e falhas por dia nos últimos ${d.days} dias` });

  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    svg.append(s('line', { class: 'grid-line', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), 'stroke-width': 1 }), s('text', { x: pad.l - 8, y: y(v) + 4, 'text-anchor': 'end' }, fmt.number(v)));
  }

  const every = Math.ceil(d.perDay.length / 8);
  d.perDay.forEach((p, i) => {
    const cx = pad.l + slot * i + slot / 2;
    const x = cx - bw / 2;
    const total = p.published + p.failed;
    if (p.published) {
      const top = y(p.published);
      const hgt = pad.t + ih - top;
      svg.append(s('path', { d: p.failed ? `M${x},${top}H${x + bw}V${top + hgt}H${x}Z` : topRounded(x, top, bw, hgt, 4), fill: 'var(--series-1)' }));
    }
    if (p.failed) {
      const top = y(total);
      const hgt = Math.max(1, y(p.published) - top - (p.published ? GAP : 0));
      svg.append(s('path', { d: topRounded(x, top, bw, hgt, 4), fill: 'var(--critical)' }));
    }
    // Conta a partir do fim: o dia de hoje sempre ganha rótulo e o espaçamento fica uniforme.
    if ((d.perDay.length - 1 - i) % every === 0) {
      const last = i === d.perDay.length - 1;
      svg.append(s('text', { x: last ? Math.min(W - pad.r, cx + bw / 2) : cx, y: H - 8, 'text-anchor': last ? 'end' : 'middle' }, fmt.date(dayLabel(p.date)).replace('.', '')));
    }
    const hit = s('rect', { class: 'hit', x: pad.l + slot * i, y: pad.t, width: slot, height: ih, rx: 4 });
    hit.addEventListener('mouseenter', () => {
      clear(
        tip,
        h('div', { style: { fontWeight: 650, marginBottom: '4px' } }, fmt.dateLong(dayLabel(p.date))),
        h('div', { class: 'r' }, h('i', { class: 'swatch', style: { width: '10px', height: '10px', borderRadius: '3px', background: 'var(--series-1)' } }), 'Publicados', h('b', String(p.published))),
        h('div', { class: 'r' }, h('i', { style: { width: '10px', height: '10px', borderRadius: '3px', background: 'var(--critical)' } }), 'Falhas', h('b', String(p.failed))),
      );
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const left = ((pad.l + slot * i + slot / 2) / W) * box.width;
      tip.style.left = `${Math.min(Math.max(0, left - 80), box.width - 170)}px`;
      tip.style.top = '0px';
    });
    hit.addEventListener('mouseleave', () => (tip.hidden = true));
    svg.append(hit);
  });
  svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: pad.t + ih, y2: pad.t + ih, stroke: 'var(--line-strong)', 'stroke-width': 1 }));
  wrap.append(svg, tip);

  const table = h(
    'table',
    { class: 'data-table', hidden: true },
    h('thead', h('tr', h('th', 'Dia'), h('th', 'Publicados'), h('th', 'Falhas'))),
    h('tbody', [...d.perDay].reverse().map((p) => h('tr', h('td', fmt.date(dayLabel(p.date))), h('td', String(p.published)), h('td', String(p.failed))))),
  );
  const toggle = h('button', { class: 'btn ghost sm', onclick: () => ((table.hidden = !table.hidden), (wrap.hidden = !table.hidden), (toggle.textContent = table.hidden ? 'Ver como tabela' : 'Ver gráfico')) }, 'Ver como tabela');

  return h(
    'section',
    { class: 'card' },
    h(
      'div',
      { class: 'card-head' },
      h('h2', 'Publicações por dia'),
      h('div', { class: 'actions' }, h('span', { class: 'key' }, h('i', { style: { background: 'var(--series-1)' } }), 'Publicados'), h('span', { class: 'key' }, h('i', { style: { background: 'var(--critical)' } }), 'Falhas'), toggle),
    ),
    wrap,
    h('div', { style: { maxHeight: '320px', overflow: 'auto' } }, table),
  );
}

function breakdown(title, data, label) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  return h(
    'section',
    { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', title), h('span', { class: 'sub' }, 'publicados')),
    entries.length
      ? entries.map(([k, v]) =>
          h('div', { class: 'hbar' }, h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '4px' } }, label(k)), h('div', { class: 'track' }, h('span', { style: { width: `${(v / max) * 100}%`, background: 'var(--series-1)' } })), h('span', { class: 'n' }, fmt.number(v))),
        )
      : h('p', { class: 'muted', style: { margin: 0 } }, 'Sem publicações no período.'),
  );
}

function heatmap(d) {
  const max = Math.max(0, ...d.heatmap.flat());
  const step = (v) => (v === 0 ? null : `var(--seq-${Math.min(5, 1 + Math.floor((v / max) * 4.999))})`);
  const cells = [h('span'), ...Array.from({ length: 24 }, (_, hr) => h('span', { class: 'hl' }, hr % 3 === 0 ? `${hr}h` : ''))];
  // Começa na segunda-feira, como a semana de trabalho.
  for (const wd of [1, 2, 3, 4, 5, 6, 0]) {
    cells.push(h('span', { class: 'lbl' }, DAYS[wd]));
    for (let hr = 0; hr < 24; hr++) {
      const v = d.heatmap[wd][hr];
      cells.push(h('span', { class: 'c', title: `${DAYS[wd]}, ${hr}h: ${v} publicaç${v === 1 ? 'ão' : 'ões'}`, style: step(v) ? { background: step(v) } : null }));
    }
  }
  return h(
    'section',
    { class: 'card', style: { marginTop: '16px' } },
    h(
      'div',
      { class: 'card-head' },
      h('div', h('h2', 'Quando seus posts vão ao ar'), h('div', { class: 'sub' }, 'Publicações por dia da semana e hora, no seu fuso.')),
      max ? h('div', { class: 'key' }, 'menos', [1, 2, 3, 4, 5].map((i) => h('i', { style: { background: `var(--seq-${i})` } })), 'mais') : null,
    ),
    max ? h('div', { class: 'heat' }, cells) : h('p', { class: 'muted', style: { margin: 0 } }, 'Sem publicações no período.'),
  );
}
