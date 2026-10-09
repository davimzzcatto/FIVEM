import { api } from '../api.js';
import { store } from '../store.js';
import { h, clear, icon, toast, openModal, fmt, platformIcon, statusBadge, mediaThumb, emptyState, dateKey, STATUS, loading } from '../ui.js';
import { TYPES } from '../../lib/rules.js';
import { openPost } from './post-modal.js';

const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const MAX_IN_CELL = 4;

function readPref(key, fallback) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}

export async function render(root, { query }) {
  const today = new Date();
  const state = {
    cursor: new Date(today.getFullYear(), today.getMonth(), 1),
    view: readPref('fp-cal-view', window.innerWidth < 640 ? 'list' : 'month'),
    workspace: query.marca || '',
    status: query.status || '',
    posts: [],
  };

  const title = h('h1');
  const body = h('div', loading());
  const viewToggle = h('div', { class: 'segmented' });
  const wsSelect = h(
    'select',
    { class: 'input', style: { width: 'auto' }, 'aria-label': 'Marca', onchange: (e) => ((state.workspace = e.target.value), load()) },
    h('option', { value: '' }, 'Todas as marcas'),
    store.workspaces.map((w) => h('option', { value: String(w.id), selected: state.workspace === String(w.id) }, w.name)),
  );
  const statusSelect = h(
    'select',
    { class: 'input', style: { width: 'auto' }, 'aria-label': 'Status', onchange: (e) => ((state.status = e.target.value), load()) },
    h('option', { value: '' }, 'Todos os status'),
    Object.entries(STATUS)
      .filter(([k]) => k !== 'draft')
      .map(([k, l]) => h('option', { value: k, selected: state.status === k }, l)),
  );

  const move = (delta) => {
    state.cursor = new Date(state.cursor.getFullYear(), state.cursor.getMonth() + delta, 1);
    load();
  };

  function paintToggle() {
    clear(
      viewToggle,
      [
        ['month', 'Mês'],
        ['list', 'Lista'],
      ].map(([v, l]) => h('button', { class: state.view === v ? 'on' : '', onclick: () => ((state.view = v), writePref('fp-cal-view', v), paintToggle(), paint()) }, l)),
    );
  }

  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', title, h('p', 'Arraste um post agendado para outro dia para reagendar no mesmo horário.')),
      h(
        'div',
        { class: 'actions' },
        h('button', { class: 'btn icon', 'aria-label': 'Mês anterior', onclick: () => move(-1) }, icon('left')),
        h('button', { class: 'btn', onclick: () => ((state.cursor = new Date(today.getFullYear(), today.getMonth(), 1)), load()) }, 'Hoje'),
        h('button', { class: 'btn icon', 'aria-label': 'Próximo mês', onclick: () => move(1) }, icon('right')),
        viewToggle,
      ),
    ),
    h('div', { class: 'actions', style: { marginBottom: '14px' } }, store.workspaces.length > 1 ? wsSelect : null, statusSelect, h('span', { class: 'spacer' }), legend()),
    body,
  );

  function range() {
    const first = state.cursor;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - first.getDay());
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    return { start, end };
  }

  async function load() {
    title.textContent = fmt.month(state.cursor).replace(/^./, (c) => c.toUpperCase());
    const { start, end } = range();
    try {
      state.posts = await api.get('/api/posts', { from: start.getTime(), to: end.getTime(), workspace_id: state.workspace, status: state.status, limit: 1000 });
    } catch (err) {
      clear(body, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, err.message)));
      return;
    }
    paint();
  }

  function byDay() {
    const map = new Map();
    for (const p of state.posts) {
      const k = dateKey(p.scheduled_at);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
    return map;
  }

  function chip(p) {
    const draggable = p.status === 'scheduled';
    return h(
      'div',
      {
        class: `ev s-${p.status}`,
        draggable: draggable ? 'true' : 'false',
        title: `${fmt.time(p.scheduled_at)} · @${p.account?.username} · ${TYPES[p.type]?.label} · ${STATUS[p.status]}`,
        onclick: () => openPost(p.id, { onChange: load }),
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', String(p.id));
          e.dataTransfer.effectAllowed = 'move';
        },
      },
      p.account ? platformIcon(p.account.platform) : null,
      h('span', { class: 't' }, fmt.time(p.scheduled_at)),
      h('span', { class: 'u' }, `@${p.account?.username || ''}`),
    );
  }

  async function reschedule(id, day) {
    const p = state.posts.find((x) => x.id === Number(id));
    if (!p) return;
    const old = new Date(p.scheduled_at);
    const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), old.getHours(), old.getMinutes()).getTime();
    if (at === p.scheduled_at) return;
    if (at < Date.now()) return toast('Esse horário já passou nesse dia.', 'warn');
    try {
      const r = await api.patch(`/api/posts/${p.id}`, { scheduled_at: at });
      toast(`Reagendado para ${fmt.dateTime(at)}.`);
      for (const w of r.warnings || []) toast(w, 'warn', 7000);
      load();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function showDay(day, list) {
    const m = openModal({
      title: fmt.dateLong(day).replace(/^./, (c) => c.toUpperCase()),
      body: h('div', { class: 'list' }, list.map((p) => row(p, () => m.close()))),
    });
  }

  function row(p, before) {
    return h(
      'div',
      { class: 'list-item clickable', onclick: () => (before?.(), openPost(p.id, { onChange: load })) },
      mediaThumb(p.media[0]),
      h('div', { class: 'grow' }, h('div', { class: 'title' }, p.caption.split('\n')[0] || h('span', { class: 'faint' }, TYPES[p.type]?.label)), h('div', { class: 'meta' }, `@${p.account?.username} · ${TYPES[p.type]?.label}`)),
      h('div', { class: 'nowrap', style: { fontWeight: 650 } }, fmt.time(p.scheduled_at)),
      statusBadge(p.status),
    );
  }

  function paintMonth() {
    const { start } = range();
    const map = byDay();
    const todayKey = dateKey(Date.now());
    const cells = [];
    for (let i = 0; i < 42; i++) {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = dateKey(day.getTime());
      const list = (map.get(key) || []).sort((a, b) => a.scheduled_at - b.scheduled_at);
      const past = key < todayKey;
      const cell = h(
        'div',
        {
          class: `cal-cell ${day.getMonth() !== state.cursor.getMonth() ? 'other' : ''} ${key === todayKey ? 'today' : ''}`,
          ondragover: (e) => {
            if (past) return;
            e.preventDefault();
            cell.classList.add('drop');
          },
          ondragleave: () => cell.classList.remove('drop'),
          ondrop: (e) => {
            e.preventDefault();
            cell.classList.remove('drop');
            reschedule(e.dataTransfer.getData('text/plain'), day);
          },
        },
        h(
          'div',
          { class: 'day-row' },
          h('span', { class: 'day' }, String(day.getDate())),
          past ? null : h('a', { class: 'add', href: `#/agendar?data=${key}`, title: 'Agendar neste dia', 'aria-label': `Agendar em ${key}` }, icon('plus', 14)),
        ),
        list.slice(0, MAX_IN_CELL).map(chip),
        list.length > MAX_IN_CELL ? h('button', { class: 'more', onclick: () => showDay(day, list) }, `+${list.length - MAX_IN_CELL} mais`) : null,
      );
      cells.push(cell);
    }
    return h('div', { class: 'cal' }, h('div', { class: 'cal-head' }, WEEK.map((d) => h('div', d))), h('div', { class: 'cal-grid' }, cells));
  }

  function paintList() {
    const month = state.cursor.getMonth();
    const days = [...byDay()]
      .filter(([k]) => Number(k.slice(5, 7)) - 1 === month)
      .sort(([a], [b]) => a.localeCompare(b));
    if (!days.length) {
      return h('div', { class: 'card' }, emptyState({ title: 'Nada neste mês', text: 'Nenhum post com esses filtros.', action: h('a', { class: 'btn primary', href: '#/agendar' }, 'Agendar posts') }));
    }
    return h(
      'div',
      { class: 'card' },
      days.map(([k, list]) => {
        const [y, m, d] = k.split('-').map(Number);
        return h('div', { class: 'day-group' }, h('h4', fmt.dateLong(new Date(y, m - 1, d))), h('div', { class: 'list' }, list.sort((a, b) => a.scheduled_at - b.scheduled_at).map((p) => row(p))));
      }),
    );
  }

  function paint() {
    clear(body, state.view === 'month' ? paintMonth() : paintList());
  }

  paintToggle();
  await load();
  const timer = setInterval(() => !document.querySelector('.modal-back') && load(), 30_000);
  return () => clearInterval(timer);
}

function legend() {
  const items = [
    ['var(--info)', 'Agendado'],
    ['var(--warn)', 'Publicando'],
    ['var(--ok)', 'Publicado'],
    ['var(--err)', 'Falhou'],
  ];
  return h('div', { class: 'legend' }, items.map(([c, l]) => h('span', h('i', { style: { background: c } }), l)));
}
