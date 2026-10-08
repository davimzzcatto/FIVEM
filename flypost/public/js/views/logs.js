import { api } from '../api.js';
import { h, clear, icon, toast, fmt, platformIcon, mediaThumb, emptyState, loading, confirmDialog } from '../ui.js';
import { TYPES } from '../../lib/rules.js';
import { openPost } from './post-modal.js';

const LEVELS = [
  ['', 'Tudo'],
  ['success', 'Publicados'],
  ['error', 'Erros'],
  ['warn', 'Avisos'],
  ['info', 'Informações'],
];
const LEVEL_ICON = { success: ['check', 'var(--ok)'], error: ['alert', 'var(--err)'], warn: ['alert', 'var(--warn)'], info: ['clock', 'var(--muted)'] };

export async function render(root, { query }) {
  const state = { tab: query.aba === 'falhas' ? 'failed' : 'activity', level: '', rows: [], done: false };
  const tabs = h('div', { class: 'segmented' });
  const filters = h('div', { class: 'chips' });
  const body = h('div', { class: 'card' }, loading());

  root.append(
    h('div', { class: 'page-head' }, h('div', h('h1', 'Histórico'), h('p', 'Tudo o que o FlyPost fez: publicações, tentativas, falhas e conexões de conta.')), tabs),
    h('div', { style: { marginBottom: '14px' } }, filters),
    body,
  );

  function paintTabs() {
    clear(
      tabs,
      [
        ['activity', 'Atividade'],
        ['failed', 'Falhas'],
      ].map(([k, l]) => h('button', { class: state.tab === k ? 'on' : '', onclick: () => ((state.tab = k), paintTabs(), load(true)) }, l)),
    );
    filters.hidden = state.tab !== 'activity';
    clear(filters, LEVELS.map(([v, l]) => h('button', { class: `chip ${state.level === v ? 'on' : ''}`, style: { paddingLeft: '12px' }, onclick: () => ((state.level = v), paintTabs(), load(true)) }, l)));
  }

  async function load(reset) {
    if (reset) {
      state.rows = [];
      state.done = false;
      clear(body, loading());
    }
    try {
      if (state.tab === 'failed') {
        state.rows = await api.get('/api/posts', { status: 'failed', order: 'desc', limit: 200 });
        state.done = true;
      } else {
        const before = state.rows.at(-1)?.id;
        const page = await api.get('/api/logs', { level: state.level, before, limit: 50 });
        state.rows.push(...page);
        state.done = page.length < 50;
      }
    } catch (err) {
      clear(body, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, err.message)));
      return;
    }
    paint();
  }

  function paint() {
    if (state.tab === 'failed') return paintFailed();
    if (!state.rows.length) return clear(body, emptyState({ iconName: 'list', title: 'Nada por aqui ainda', text: 'Assim que algo for publicado ou uma conta for conectada, aparece aqui.' }));
    clear(
      body,
      h(
        'div',
        { class: 'list' },
        state.rows.map((l) => {
          const [ic, color] = LEVEL_ICON[l.level] || LEVEL_ICON.info;
          return h(
            'div',
            { class: `list-item ${l.post_id ? 'clickable' : ''}`, onclick: l.post_id && l.post_status ? () => openPost(l.post_id, { onChange: () => load(true) }) : null },
            h('span', { style: { color, display: 'inline-flex' } }, icon(ic, 18)),
            h('div', { class: 'grow' }, h('div', { class: 'pre', style: { fontWeight: 500 } }, l.message), h('div', { class: 'meta' }, l.username ? [platformIcon(l.platform), ' '] : null, l.username ? `@${l.username} · ` : '', fmt.full(l.created_at))),
            h('span', { class: 'faint small nowrap' }, fmt.relative(l.created_at)),
          );
        }),
      ),
      state.done ? null : h('div', { style: { textAlign: 'center', marginTop: '12px' } }, h('button', { class: 'btn', onclick: (e) => ((e.currentTarget.disabled = true), load(false)) }, 'Carregar mais')),
    );
  }

  function paintFailed() {
    if (!state.rows.length) return clear(body, emptyState({ iconName: 'check', title: 'Nenhuma falha', text: 'Quando um post falhar, ele aparece aqui com o motivo e um botão para tentar de novo.' }));
    clear(
      body,
      h(
        'div',
        { class: 'card-head' },
        h('h3', `${state.rows.length} post${state.rows.length > 1 ? 's' : ''} com falha`),
        h(
          'button',
          {
            class: 'btn sm',
            onclick: async () => {
              if (!(await confirmDialog({ title: 'Tentar todos de novo?', message: 'Os posts com falha entram na fila para publicar agora. Antes, confira se o motivo (ex.: conta desconectada) foi resolvido.', confirmText: 'Tentar todos' }))) return;
              let ok = 0;
              let fail = 0;
              for (const p of state.rows) {
                try {
                  await api.post(`/api/posts/${p.id}/retry`);
                  ok++;
                } catch {
                  fail++;
                }
              }
              toast(`${ok} na fila de novo${fail ? `, ${fail} não puderam` : ''}.`, fail ? 'warn' : 'ok');
              load(true);
            },
          },
          icon('refresh', 14),
          'Tentar todos',
        ),
      ),
      h(
        'div',
        { class: 'list' },
        state.rows.map((p) =>
          h(
            'div',
            { class: 'list-item clickable', onclick: () => openPost(p.id, { onChange: () => load(true) }) },
            mediaThumb(p.media[0]),
            h('div', { class: 'grow' }, h('div', { class: 'title' }, `@${p.account?.username} · ${TYPES[p.type]?.label}`), h('div', { class: 'meta', style: { color: 'var(--err)', whiteSpace: 'normal' } }, p.last_error || 'Sem detalhe'), h('div', { class: 'meta' }, `Agendado para ${fmt.full(p.scheduled_at)}`)),
            h(
              'button',
              {
                class: 'btn sm',
                onclick: async (e) => {
                  e.stopPropagation();
                  const btn = e.currentTarget;
                  btn.disabled = true;
                  try {
                    await api.post(`/api/posts/${p.id}/retry`);
                    toast('Na fila de novo.');
                    load(true);
                  } catch (err) {
                    toast(err.message, 'err');
                    btn.disabled = false;
                  }
                },
              },
              icon('refresh', 14),
              'Tentar de novo',
            ),
          ),
        ),
      ),
    );
  }

  paintTabs();
  await load(true);
  const timer = setInterval(() => state.tab === 'activity' && !state.level && state.rows.length <= 50 && !document.querySelector('.modal-back') && load(true), 30_000);
  return () => clearInterval(timer);
}
