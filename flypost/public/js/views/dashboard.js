import { api } from '../api.js';
import { store } from '../store.js';
import { h, clear, icon, fmt, avatar, statusBadge, accountBadge, emptyState, mediaThumb, loading } from '../ui.js';
import { TYPES } from '../../lib/rules.js';
import { openPost } from './post-modal.js';

export async function render(root) {
  const body = h('div', loading());
  const first = (store.me?.user.name || '').split(' ')[0];
  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', h('h1', first ? `Olá, ${first}` : 'Painel'), h('p', fmt.dateLong(Date.now()).replace(/^./, (c) => c.toUpperCase()))),
      h('div', { class: 'actions' }, h('a', { class: 'btn', href: '#/calendario' }, icon('calendar', 16), 'Calendário'), h('a', { class: 'btn primary', href: '#/agendar' }, icon('plus', 16), 'Agendar posts')),
    ),
    body,
  );

  async function load() {
    const d = await api.get('/api/dashboard');
    store.loadMe().catch(() => {});
    clear(body, ...paint(d, load));
  }
  await load();
  const timer = setInterval(() => load().catch(() => {}), 20_000);
  return () => clearInterval(timer);
}

function paint(d, reload) {
  const out = [];
  const expired = d.accounts.filter((a) => a.status === 'expired');
  if (expired.length) {
    out.push(
      h(
        'div',
        { class: 'alert err' },
        icon('alert'),
        h('div', { class: 'grow' }, h('b', `${expired.length === 1 ? 'Uma conta precisa' : `${expired.length} contas precisam`} ser reconectada${expired.length > 1 ? 's' : ''}: `), expired.map((a) => `@${a.username}`).join(', '), '. Os posts dela ficam em espera até lá.'),
        h('a', { class: 'btn sm', href: '#/contas' }, 'Reconectar'),
      ),
    );
  }

  if (!d.accounts.length) {
    out.push(
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', 'Comece por aqui')),
        h(
          'div',
          { class: 'grid grid-4' },
          step(1, 'Conecte uma conta', 'Instagram, Facebook ou TikTok. Sem credenciais? Use uma conta de teste.', h('a', { class: 'btn primary sm', href: '#/contas' }, 'Conectar')),
          step(2, 'Envie as mídias', 'Arraste dezenas de vídeos ou imagens de uma vez.', null),
          step(3, 'Distribua os horários', 'Escolha horários fixos ou um intervalo e o FlyPost preenche tudo.', null),
          step(4, 'Acompanhe', 'Calendário, histórico e avisos por webhook a cada publicação.', null),
        ),
      ),
    );
  }

  const { used, limit } = d.usage;
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const c = d.counts;
  const nextAt = d.next.find((p) => p.status === 'scheduled')?.scheduled_at;
  out.push(
    h(
      'div',
      { class: 'grid grid-4', style: { marginBottom: '16px' } },
      kpi('Posts no mês', [fmt.number(used), h('small', ` / ${fmt.number(limit)}`)], h('div', { class: `bar ${pct >= 100 ? 'err' : pct >= 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } })), `Plano ${d.plan.name}`),
      kpi('Na fila', fmt.number(c.scheduled), null, nextAt ? `Próximo ${fmt.relative(nextAt)}` : 'Nada agendado'),
      kpi('Publicados (30 dias)', fmt.number(c.published30), null, d.last ? `Último ${fmt.relative(d.last.published_at)}` : 'Nenhum ainda'),
      kpi(
        'Taxa de sucesso',
        c.successRate == null ? '—' : `${String(c.successRate).replace('.', ',')}%`,
        null,
        c.failedOpen ? h('a', { href: '#/historico?aba=falhas', style: { color: 'var(--err)' } }, `${c.failedOpen} falha${c.failedOpen > 1 ? 's' : ''} nos últimos 7 dias`) : 'Sem falhas recentes',
      ),
    ),
  );

  const nextList = d.next.length
    ? h(
        'div',
        { class: 'list' },
        d.next.map((p) =>
          h(
            'div',
            { class: 'list-item clickable', onclick: () => openPost(p.id, { onChange: reload }) },
            mediaThumb(p.media[0]),
            h('div', { class: 'grow' }, h('div', { class: 'title' }, p.caption.split('\n')[0] || h('span', { class: 'faint' }, 'Sem legenda')), h('div', { class: 'meta' }, `@${p.account?.username} · ${TYPES[p.type]?.label}`)),
            h('div', { style: { textAlign: 'right' } }, h('div', { class: 'nowrap', style: { fontWeight: 600 } }, fmt.dateTime(p.scheduled_at)), p.status === 'publishing' ? statusBadge('publishing') : h('div', { class: 'meta' }, fmt.relative(p.scheduled_at))),
          ),
        ),
      )
    : emptyState({ title: 'Nada na fila', text: 'Agende um lote e ele aparece aqui, em ordem de publicação.', action: h('a', { class: 'btn primary', href: '#/agendar' }, 'Agendar posts') });

  const accList = d.accounts.length
    ? h(
        'div',
        { class: 'list' },
        d.accounts.map((a) =>
          h(
            'div',
            { class: 'list-item' },
            avatar(a),
            h('div', { class: 'grow' }, h('div', { class: 'title' }, `@${a.username}`), h('div', { class: 'meta' }, a.mode === 'simulated' ? 'Conta de teste' : a.display_name || '')),
            accountBadge(a),
          ),
        ),
      )
    : h('p', { class: 'muted' }, 'Nenhuma conta conectada ainda.');

  out.push(
    h(
      'div',
      { class: 'grid', style: { gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)' }, 'data-stack': '' },
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Próximas publicações'), h('a', { class: 'btn ghost sm', href: '#/calendario' }, 'Ver calendário', icon('right', 14))), nextList),
      h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', 'Contas'), h('a', { class: 'btn ghost sm', href: '#/contas' }, 'Gerenciar', icon('right', 14))), accList),
    ),
  );
  return out;
}

function kpi(label, value, extra, foot) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'label' }, label), h('div', { class: 'value' }, value), extra, h('div', { class: 'foot' }, foot));
}

function step(n, title, text, action) {
  return h('div', h('div', { class: 'step-num', style: { marginBottom: '10px' } }, String(n)), h('div', { style: { fontWeight: 650 } }, title), h('p', { class: 'muted small', style: { margin: '4px 0 10px' } }, text), action);
}
