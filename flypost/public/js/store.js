import { api } from './api.js';

// Estado compartilhado entre as telas.
const listeners = new Set();

export const store = {
  config: null,
  me: null,
  workspaces: [],

  async loadConfig() {
    this.config = await api.get('/api/config');
    return this.config;
  },
  async loadMe() {
    this.me = await api.get('/api/me');
    emit();
    return this.me;
  },
  async loadWorkspaces() {
    this.workspaces = await api.get('/api/workspaces');
    emit();
    return this.workspaces;
  },
  get accounts() {
    return this.workspaces.flatMap((w) => w.accounts);
  },
  workspaceOf(id) {
    return this.workspaces.find((w) => w.id === id);
  },
  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

function emit() {
  for (const fn of listeners) fn(store);
}

// Preferência de tema: 'auto' segue o sistema.
export function applyTheme(theme = readTheme()) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}
export function readTheme() {
  try {
    return localStorage.getItem('fp-theme') || 'auto';
  } catch {
    return 'auto';
  }
}
export function saveTheme(theme) {
  try {
    localStorage.setItem('fp-theme', theme);
  } catch {
    /* navegação privada: vale só nesta sessão */
  }
  applyTheme(theme);
}
