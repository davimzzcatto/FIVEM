import { api, setUnauthorizedHandler } from './api.js';
import { store, applyTheme } from './store.js';
import { h, clear, icon, toast, loading, fmt } from './ui.js';

const ROUTES = {
  painel: { label: 'Painel', icon: 'home', load: () => import('./views/dashboard.js') },
  agendar: { label: 'Agendar', icon: 'plus', load: () => import('./views/schedule.js') },
  calendario: { label: 'Calendário', icon: 'calendar', load: () => import('./views/calendar.js') },
  contas: { label: 'Contas', icon: 'users', load: () => import('./views/accounts.js') },
  historico: { label: 'Histórico', icon: 'list', load: () => import('./views/logs.js') },
  analises: { label: 'Análises', icon: 'chart', load: () => import('./views/analytics.js') },
  configuracoes: { label: 'Configurações', icon: 'sliders', load: () => import('./views/settings.js') },
  api: { label: 'API', icon: 'code', load: () => import('./views/apidocs.js') },
};

const root = document.getElementById('app');
let shell = null;
let cleanup = null;
let renderToken = 0;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  const name = ROUTES[path] ? path : 'painel';
  return { name, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export function go(name, query) {
  const qs = query ? `?${new URLSearchParams(query)}` : '';
  location.hash = `#/${name}${qs}`;
}

function brand() {
  return h('a', { class: 'brand', href: '#/painel' }, h('span', { class: 'brand-mark' }, icon('plane', 18)), 'FlyPost');
}

function buildShell() {
  const nav = h(
    'nav',
    { class: 'nav' },
    Object.entries(ROUTES).map(([key, r]) => h('a', { href: `#/${key}`, dataset: { route: key } }, icon(r.icon), r.label, key === 'contas' ? h('span', { class: 'badge b-expired plain', hidden: true, dataset: { slot: 'expired' } }) : null)),
  );
  const usage = h('div', { class: 'usage-card' });
  const userRow = h('div', { class: 'user-row' });
  const sidebar = h('aside', { class: 'sidebar' }, brand(), nav, h('div', { class: 'sidebar-foot' }, usage, userRow));
  const view = h('main', { class: 'view', id: 'view' });
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn ghost icon', 'aria-label': 'Abrir menu', onclick: () => toggleMenu(true) }, icon('menu')),
    brand(),
    h('span', { class: 'spacer' }),
    h('a', { class: 'btn primary sm', href: '#/agendar' }, icon('plus', 16), 'Agendar'),
  );
  const el = h('div', { class: 'shell' }, sidebar, h('div', { class: 'main' }, topbar, view));
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => toggleMenu(false) });
  el.append(scrim);

  function toggleMenu(open) {
    el.classList.toggle('menu-open', open);
    scrim.hidden = !open;
  }

  function paintUser() {
    const me = store.me;
    if (!me) return;
    const { used, limit } = me.usage;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    clear(
      usage,
      h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', 'Plano ', h('strong', me.plan.name)), h('span', `${fmt.number(used)}/${fmt.number(limit)}`)),
      h('div', { class: `bar ${pct >= 100 ? 'err' : pct >= 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } })),
      h('div', { style: { marginTop: '6px' } }, 'posts neste mês'),
    );
    clear(
      userRow,
      h('span', { class: 'avatar' }, me.user.name.slice(0, 1).toUpperCase()),
      h('div', { class: 'who' }, h('div', { style: { fontWeight: 600 } }, me.user.name), h('div', { class: 'email' }, me.user.email)),
      h('button', { class: 'btn ghost icon sm', title: 'Sair', 'aria-label': 'Sair', onclick: logout }, icon('logout', 16)),
    );
    const expired = store.accounts.filter((a) => a.status === 'expired').length;
    const slot = nav.querySelector('[data-slot="expired"]');
    slot.hidden = !expired;
    slot.textContent = expired;
  }
  store.subscribe(paintUser);
  paintUser();

  return { el, view, nav, toggleMenu };
}

async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  store.me = null;
  shell = null;
  location.hash = '';
  showLogin();
}

async function showLogin() {
  cleanup?.();
  cleanup = null;
  const mod = await import('./views/login.js');
  clear(root);
  mod.render(root, {
    onDone: async () => {
      await start();
    },
  });
}

async function route() {
  if (!shell) return;
  const { name, query } = parseHash();
  const r = ROUTES[name];
  const token = ++renderToken;
  shell.toggleMenu(false);
  for (const a of shell.nav.querySelectorAll('a')) a.classList.toggle('active', a.dataset.route === name);
  document.title = `${r.label} · FlyPost`;
  cleanup?.();
  cleanup = null;
  clear(shell.view, loading());
  try {
    const mod = await r.load();
    if (token !== renderToken) return;
    clear(shell.view);
    window.scrollTo(0, 0);
    cleanup = (await mod.render(shell.view, { query, go })) || null;
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    clear(shell.view, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, h('b', 'Não foi possível abrir esta tela. '), err.message)));
  }
}

async function start() {
  try {
    await Promise.all([store.loadMe(), store.loadWorkspaces()]);
  } catch (err) {
    if (err.status === 401) return showLogin();
    clear(root, h('div', { class: 'view' }, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, err.message, ' ', h('a', { href: '/' }, 'Tentar de novo')))));
    return;
  }
  shell = buildShell();
  clear(root, shell.el);
  await route();
}

applyTheme();
setUnauthorizedHandler(() => {
  if (store.me) toast('Sua sessão expirou. Entre de novo.', 'warn');
  store.me = null;
  shell = null;
  showLogin();
});
window.addEventListener('hashchange', route);
store.loadConfig().catch(() => {});
start();
