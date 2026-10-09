// Utilitários de interface: criação de elementos, ícones, modais, toasts e formatação.

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected' || k === 'disabled' || k === 'indeterminate') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

// ---------- Ícones (desenhados para o FlyPost, traço 1.8) ----------

const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2A5.5 5.5 0 0 1 21.5 20"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  chart: '<path d="M4 20V11M10 20V5M16 20v-6M2 20h20"/>',
  sliders: '<path d="M4 6h9M19 6h1M4 12h3M13 12h7M4 18h11M21 18h-1"/><circle cx="16" cy="6" r="2.2"/><circle cx="10" cy="12" r="2.2"/><circle cx="18" cy="18" r="2.2"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
  logout: '<path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  left: '<path d="m15 6-6 6 6 6"/>',
  right: '<path d="m9 6 6 6-6 6"/>',
  upload: '<path d="M12 16V4M7 9l5-5 5 5M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  check: '<path d="M5 12.5 9.5 17 19 7"/>',
  alert: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.2 2"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  shuffle: '<path d="M4 7h3c5 0 5 10 10 10h3M17 4l3 3-3 3M4 17h3c1.7 0 2.8-1.1 3.7-2.6M13.3 9.6C14.2 8.1 15.3 7 17 7h3M17 14l3 3-3 3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
  video: '<rect x="3" y="6" width="13" height="12" rx="2.5"/><path d="m16 10.5 5-3v9l-5-3"/>',
  layers: '<path d="M12 3 3 8l9 5 9-5zM3 13l9 5 9-5"/>',
  story: '<circle cx="12" cy="12" r="9" stroke-dasharray="3 2.6"/><circle cx="12" cy="12" r="4.5"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
  bolt: '<path d="M13 3 4 14h7l-1 7 9-11h-7z"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>',
  wand: '<path d="M4 20 15 9M14 4v2M19 9h2M17.5 5.5 19 4M9 4l.5 1.5M19 14l1.5.5"/><path d="m13.5 7.5 3 3"/>',
  plane: '<path d="M3 11.2 21 3l-8.2 18-2.4-7.4z" fill="currentColor" stroke="none"/><path d="M10.4 13.6 21 3" stroke="rgba(0,0,0,.25)"/>',
  instagram: '<rect x="4" y="4" width="16" height="16" rx="5"/><circle cx="12" cy="12" r="3.6"/><circle cx="16.8" cy="7.2" r="1" fill="currentColor" stroke="none"/>',
  facebook: '<path d="M14.5 4H13a3 3 0 0 0-3 3v13M7 10.5h7.5"/>',
  tiktok: '<path d="M14.5 3v11.5a3.5 3.5 0 1 1-3.5-3.5"/><path d="M14.5 3c.5 2.5 2.2 4 4.5 4.3"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.style.display = 'inline-flex';
  span.setAttribute('aria-hidden', 'true');
  // Conteúdo fixo deste arquivo (nunca dado do usuário), por isso pode ir como markup.
  span.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${P[name] || ''}</svg>`;
  return span;
}

export const PLATFORM_LABEL = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
export const TYPE_ICON = { reels: 'video', image: 'image', carousel: 'layers', story: 'story' };

export function platformIcon(platform) {
  return h('span', { class: `pf pf-${platform}`, title: PLATFORM_LABEL[platform] }, icon(platform, 12));
}

export function avatar(account, size = '') {
  const name = account?.display_name || account?.username || '?';
  const initials = name.replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '@';
  const inner = account?.avatar_url ? h('img', { src: account.avatar_url, alt: '', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(initials) }) : initials;
  return h('span', { class: 'avatar-wrap' }, h('span', { class: `avatar ${size}` }, inner), account?.platform ? platformIcon(account.platform) : null);
}

export const STATUS = {
  scheduled: 'Agendado',
  publishing: 'Publicando',
  published: 'Publicado',
  failed: 'Falhou',
  canceled: 'Cancelado',
  draft: 'Rascunho',
};
export const ACCOUNT_STATUS = { active: 'Ativa', expired: 'Reconectar', disabled: 'Desativada' };

export function statusBadge(status) {
  return h('span', { class: `badge b-${status}` }, STATUS[status] || status);
}

export function accountBadge(acc) {
  return h('span', { class: `badge b-${acc.status}` }, ACCOUNT_STATUS[acc.status] || acc.status);
}

// ---------- Formatação ----------

const dtf = (opts) => new Intl.DateTimeFormat('pt-BR', opts);
const F = {
  time: dtf({ hour: '2-digit', minute: '2-digit' }),
  date: dtf({ day: '2-digit', month: 'short' }),
  dateLong: dtf({ weekday: 'long', day: 'numeric', month: 'long' }),
  dateTime: dtf({ weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }),
  full: dtf({ day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
  month: dtf({ month: 'long', year: 'numeric' }),
};
export const fmt = {
  time: (ms) => F.time.format(ms),
  date: (ms) => F.date.format(ms),
  dateLong: (ms) => F.dateLong.format(ms),
  dateTime: (ms) => F.dateTime.format(ms),
  full: (ms) => F.full.format(ms),
  month: (ms) => F.month.format(ms),
  number: (n) => new Intl.NumberFormat('pt-BR').format(n),
  bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1048576).toFixed(1).replace('.', ',')} MB`;
  },
  duration(ms) {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  relative(ms) {
    const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    const diff = ms - Date.now();
    const abs = Math.abs(diff);
    if (abs < 60_000) return diff >= 0 ? 'em instantes' : 'agora há pouco';
    if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
    if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
    return rtf.format(Math.round(diff / 86_400_000), 'day');
  },
};

export function dateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function toLocalInput(ms) {
  const d = new Date(ms);
  return `${dateKey(ms)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime() : NaN;
}

// ---------- Toasts e modais ----------

let toastBox;
export function toast(message, type = 'ok', ms = 4200) {
  if (!toastBox) document.body.append((toastBox = h('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' })));
  const el = h('div', { class: `toast ${type}` }, icon(type === 'ok' ? 'check' : 'alert', 18), h('div', { class: 'grow' }, message));
  toastBox.append(el);
  setTimeout(() => el.remove(), ms);
}

export function openModal({ title, body, foot, wide = false, onClose } = {}) {
  const prevFocus = document.activeElement;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    back.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
    prevFocus?.focus?.();
  };
  const onKey = (e) => e.key === 'Escape' && close();
  const modal = h(
    'div',
    { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal-head' }, h('h3', title), h('button', { class: 'btn ghost icon sm', 'aria-label': 'Fechar', onclick: close }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    h('div', { class: 'modal-foot', hidden: !foot }, foot),
  );
  const back = h('div', { class: 'modal-back', onmousedown: (e) => e.target === back && close() }, modal);
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  setTimeout(() => (modal.querySelector('input, textarea, select') || modal.querySelector('.modal-foot .btn.primary'))?.focus(), 30);
  return { close, modal, body: modal.querySelector('.modal-body'), setFoot(nodes) {
      const el = modal.querySelector('.modal-foot');
      el.hidden = false;
      clear(el, nodes);
    },
  };
}

export function confirmDialog({ title, message, confirmText = 'Confirmar', danger = false, typeToConfirm }) {
  return new Promise((resolve) => {
    let answer = false;
    const input = typeToConfirm ? h('input', { class: 'input', placeholder: typeToConfirm, oninput: () => (ok.disabled = input.value.trim() !== typeToConfirm) }) : null;
    const ok = h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, disabled: Boolean(typeToConfirm), onclick: () => ((answer = true), m.close()) }, confirmText);
    const m = openModal({
      title,
      body: h('div', h('p', { class: 'muted', style: { margin: '0 0 12px' } }, message), input ? h('label', { class: 'field' }, h('span', `Digite "${typeToConfirm}" para confirmar`), input) : null),
      foot: [h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Voltar'), ok],
      onClose: () => resolve(answer),
    });
  });
}

export function emptyState({ iconName = 'calendar', title, text, action }) {
  return h('div', { class: 'empty' }, h('div', { class: 'icon-wrap' }, icon(iconName, 24)), h('h3', title), text ? h('p', text) : null, action || null);
}

export const loading = () => h('div', { class: 'loading' }, h('span', { class: 'spinner' }));

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Copiado.');
  } catch {
    toast('Não consegui copiar. Selecione e copie manualmente.', 'warn');
  }
}

export function codeBlock(text) {
  return h('div', { class: 'code' }, h('button', { class: 'btn sm copy', onclick: () => copyText(text) }, icon('copy', 14), 'Copiar'), text);
}

export function field(label, control, hint) {
  return h('label', { class: 'field' }, h('span', label), control, hint ? h('span', { class: 'hint' }, hint) : null);
}

export function mediaThumb(m, cls = 'thumb') {
  if (!m || m.missing) return h('div', { class: cls }, icon('image', 16));
  // O ícone fica por baixo: aparece se o navegador não conseguir decodificar o vídeo.
  if (m.kind === 'video') return h('div', { class: cls }, icon('video', 16), h('video', { src: `${m.url}#t=0.5`, muted: true, preload: 'metadata', playsinline: true }));
  return h('div', { class: cls }, h('img', { src: m.url, alt: '', loading: 'lazy' }));
}
