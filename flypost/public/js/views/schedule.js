import { api } from '../api.js';
import { store } from '../store.js';
import { h, clear, icon, toast, openModal, fmt, avatar, emptyState, field, dateKey, toLocalInput, fromLocalInput, PLATFORM_LABEL } from '../ui.js';
import { PLATFORMS, TYPES, RECOMMENDED_PER_DAY, validatePost, hashtagCount, maxInWindow, supports } from '../../lib/rules.js';
import { fixedSlots, intervalSlots, normalizeTimes, SUGGESTED_TIMES } from '../../lib/slots.js';
import { hasSpintax, countVariations, spinMany } from '../../lib/spintax.js';
import { kindOf, prepareImage, prepareVideo } from '../media-prep.js';

const MAX_FILES = 500;
const UPLOAD_CONCURRENCY = 3;
const TYPE_ORDER = ['reels', 'image', 'carousel', 'story'];
const TYPE_ICONS = { reels: 'video', image: 'image', carousel: 'layers', story: 'story' };
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const PRIVACY = [
  ['PUBLIC_TO_EVERYONE', 'Público'],
  ['FOLLOWER_OF_CREATOR', 'Seguidores'],
  ['MUTUAL_FOLLOW_FRIENDS', 'Amigos'],
  ['SELF_ONLY', 'Somente eu'],
];

// Gerador pseudoaleatório com semente: o sorteio das variações fica estável até a pessoa pedir outro.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let uid = 0;
const nextHour = () => {
  const d = new Date(Date.now() + 30 * 60_000);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d.getTime();
};

export async function render(root, { query }) {
  if (!store.workspaces.length) await store.loadWorkspaces();
  const S = {
    type: 'reels',
    accountIds: new Set(),
    files: [],
    perCarousel: 0,
    caption: '',
    firstComment: '',
    shareToFeed: true,
    tiktokPrivacy: 'PUBLIC_TO_EVERYONE',
    fit: true,
    mode: 'fixed',
    fixed: { startDate: query.data || dateKey(Date.now()), times: ['09:00', '12:00', '18:00'], perDay: 0, weekdays: [0, 1, 2, 3, 4, 5, 6] },
    interval: { start: nextHour(), every: 60, from: '08:00', to: '22:00' },
    overrides: new Map(),
    seed: 1,
    sending: false,
  };
  const queue = [];
  let active = 0;
  const objectUrls = new Set();

  const accounts = () => store.accounts;
  const selected = () => accounts().filter((a) => S.accountIds.has(a.id));
  const usable = (a) => a.status === 'active' && supports(a.platform, S.type);

  // ---------- Itens derivados (cada item vira um post em cada conta) ----------

  function items() {
    if (S.type !== 'carousel') return S.files.map((f) => ({ key: f.key, files: [f] }));
    const size = S.perCarousel || S.files.length;
    const out = [];
    for (let i = 0; i < S.files.length; i += size) {
      const files = S.files.slice(i, i + size);
      out.push({ key: files.map((f) => f.key).join('+'), files });
    }
    return out;
  }

  function times(n) {
    if (S.mode === 'now') return Array(n).fill(Date.now());
    if (S.mode === 'interval') return intervalSlots({ count: n, start: S.interval.start, everyMinutes: S.interval.every, windowStart: S.interval.from, windowEnd: S.interval.to });
    return fixedSlots({ count: n, startDate: S.fixed.startDate, times: S.fixed.times, perDay: S.fixed.perDay || undefined, weekdays: S.fixed.weekdays });
  }

  function plan() {
    const list = items();
    const slots = times(list.length);
    const captions = hasSpintax(S.caption) ? spinMany(S.caption, list.length, seeded(S.seed)) : list.map(() => S.caption);
    const comments = hasSpintax(S.firstComment) ? spinMany(S.firstComment, list.length, seeded(S.seed + 7)) : list.map(() => S.firstComment);
    return list.map((it, i) => {
      const o = S.overrides.get(it.key) || {};
      const at = S.mode === 'now' ? Date.now() : o.at ?? slots[i] ?? null;
      const caption = o.caption ?? captions[i];
      const firstComment = comments[i];
      const issues = [];
      if (at == null) issues.push('Sem horário: adicione mais horários ou dias.');
      if (it.files.some((f) => f.status === 'error')) issues.push('Falha no upload de um arquivo.');
      for (const acc of selected()) {
        const meta = it.files.map((f) => ({ kind: f.kind, width: f.width, height: f.height, duration_ms: f.duration_ms }));
        for (const msg of validatePost({ platform: acc.platform, type: S.type, media: meta, caption: S.type === 'story' ? '' : caption, firstComment })) issues.push(`@${acc.username}: ${msg}`);
      }
      return { ...it, at, caption, firstComment, issues: [...new Set(issues)] };
    });
  }

  // ---------- Seção 1: tipo e contas ----------

  const typeBox = h('div');
  const accountsBox = h('div', { style: { marginTop: '16px' } });

  function paintTarget() {
    clear(
      typeBox,
      h(
        'div',
        { class: 'segmented', role: 'tablist' },
        TYPE_ORDER.map((t) =>
          h(
            'button',
            {
              class: S.type === t ? 'on' : '',
              role: 'tab',
              'aria-selected': String(S.type === t),
              onclick: () => {
                if (S.type === t) return;
                const dropped = S.files.filter((f) => (t === 'reels' && f.kind !== 'video') || (t === 'image' && f.kind !== 'image'));
                if (dropped.length) toast(`${dropped.length} arquivo${dropped.length > 1 ? 's' : ''} não combina${dropped.length > 1 ? 'm' : ''} com ${TYPES[t].label} e saiu da lista.`, 'warn');
                S.files = S.files.filter((f) => !dropped.includes(f));
                S.type = t;
                for (const a of accounts()) if (!supports(a.platform, t)) S.accountIds.delete(a.id);
                S.overrides.clear();
                paintAll();
              },
            },
            icon(TYPE_ICONS[t], 16),
            TYPES[t].label,
          ),
        ),
      ),
    );

    const accs = accounts();
    if (!accs.length) {
      clear(accountsBox, h('div', { class: 'alert info' }, icon('alert'), h('div', { class: 'grow' }, 'Nenhuma conta conectada. Conecte uma conta (ou crie uma de teste) para agendar.'), h('a', { class: 'btn sm', href: '#/contas' }, 'Ir para Contas')));
      return;
    }
    const groups = store.workspaces.filter((w) => w.accounts.length);
    clear(
      accountsBox,
      groups.map((w) =>
        h(
          'div',
          { style: { marginBottom: '12px' } },
          groups.length > 1
            ? h(
                'div',
                { class: 'label-text', style: { margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: '8px' } },
                h('span', { style: { width: '8px', height: '8px', borderRadius: '50%', background: w.color, display: 'inline-block' } }),
                w.name,
                h('button', {
                  class: 'btn ghost sm',
                  style: { height: '22px', fontSize: '12px' },
                  onclick: () => {
                    const ok = w.accounts.filter(usable);
                    const all = ok.every((a) => S.accountIds.has(a.id));
                    for (const a of ok) all ? S.accountIds.delete(a.id) : S.accountIds.add(a.id);
                    paintTarget();
                    paintCaption();
                    refresh();
                  },
                }, 'todas'),
              )
            : null,
          h(
            'div',
            { class: 'chips' },
            w.accounts.map((a) => {
              const ok = usable(a);
              const on = S.accountIds.has(a.id);
              const why = a.status === 'expired' ? 'precisa reconectar' : a.status === 'disabled' ? 'desativada' : !supports(a.platform, S.type) ? `${PLATFORM_LABEL[a.platform]} não aceita ${TYPES[S.type].label.toLowerCase()}` : '';
              return h(
                'button',
                {
                  class: `chip ${on ? 'on' : ''} ${ok ? '' : 'off'}`,
                  title: why || `@${a.username}`,
                  'aria-pressed': String(on),
                  disabled: !ok,
                  onclick: () => {
                    on ? S.accountIds.delete(a.id) : S.accountIds.add(a.id);
                    paintTarget();
                    paintCaption();
                    refresh();
                  },
                },
                avatar(a, 'sm'),
                `@${a.username}`,
                a.mode === 'simulated' ? h('span', { class: 'badge b-sim plain' }, 'teste') : null,
                on ? icon('check', 14) : null,
              );
            }),
          ),
        ),
      ),
    );
  }

  // ---------- Seção 2: mídias ----------

  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: () => (addFiles([...fileInput.files]), (fileInput.value = '')) });
  const mediaHead = h('div');
  const tiles = h('div', { class: 'tiles' });
  const drop = h(
    'div',
    {
      class: 'dropzone',
      tabindex: '0',
      role: 'button',
      onclick: () => fileInput.click(),
      onkeydown: (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), fileInput.click()),
      ondragover: (e) => (e.preventDefault(), drop.classList.add('over')),
      ondragleave: () => drop.classList.remove('over'),
      ondrop: (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]);
      },
    },
  );

  function paintDrop() {
    const accept = { reels: 'video/mp4,video/quicktime,.mp4,.mov', image: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' }[S.type] || 'video/mp4,video/quicktime,image/jpeg,image/png,image/webp,.mp4,.mov,.jpg,.jpeg,.png,.webp';
    fileInput.accept = accept;
    const what = { reels: 'vídeos', image: 'imagens', carousel: 'imagens e vídeos', story: 'imagens ou vídeos' }[S.type];
    clear(
      drop,
      h('div', { style: { display: 'flex', justifyContent: 'center', marginBottom: '8px', color: 'var(--brand)' } }, icon('upload', 26)),
      h('b', `Arraste ${what} aqui`),
      ' ou clique para escolher',
      h('div', { class: 'small', style: { marginTop: '6px' } }, S.type === 'carousel' ? 'Os arquivos são agrupados em carrosséis na ordem da lista.' : 'Cada arquivo vira um post. Até 500 por lote.'),
    );
  }

  function paintMediaHead() {
    const n = S.files.length;
    const uploading = S.files.filter((f) => f.status !== 'done' && f.status !== 'error').length;
    clear(
      mediaHead,
      h(
        'div',
        { class: 'row', style: { alignItems: 'center', marginBottom: n ? '0' : '12px', justifyContent: 'space-between' } },
        h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: S.fit, onchange: (e) => (S.fit = e.target.checked) }), 'Encaixar imagens fora da proporção do feed (fundo desfocado)'),
        n
          ? h(
              'div',
              { class: 'actions' },
              h('span', { class: 'muted small' }, `${n} arquivo${n > 1 ? 's' : ''}${uploading ? ` · enviando ${uploading}` : ''}`),
              S.type === 'carousel'
                ? h(
                    'select',
                    {
                      class: 'input',
                      style: { width: 'auto', height: '30px' },
                      'aria-label': 'Arquivos por carrossel',
                      onchange: (e) => ((S.perCarousel = Number(e.target.value)), S.overrides.clear(), paintTiles(), refresh()),
                    },
                    h('option', { value: '0', selected: S.perCarousel === 0 }, 'Todos em um carrossel'),
                    [2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => h('option', { value: String(k), selected: S.perCarousel === k }, `${k} por carrossel`)),
                  )
                : null,
              h('button', { class: 'btn sm', onclick: () => (S.files.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true })), S.overrides.clear(), paintTiles(), refresh()) }, 'Ordenar por nome'),
              h('button', { class: 'btn ghost sm', onclick: () => (S.files.forEach(revoke), (S.files = []), S.overrides.clear(), paintMedia(), refresh()) }, 'Limpar'),
            )
          : null,
      ),
    );
  }

  let dragKey = null;
  function paintTiles() {
    const groups = S.type === 'carousel' ? items() : null;
    const tileFor = (f, i) => {
      const prog = h('span', { style: { width: `${Math.round((f.progress || 0) * 100)}%` } });
      f.progressEl = prog;
      const preview = f.previewUrl
        ? f.kind === 'video' && !f.poster
          ? [h('span', { class: 'vid-ic' }, icon('video', 26)), h('video', { src: f.previewUrl, muted: true, preload: 'metadata' })]
          : h('img', { src: f.poster || f.previewUrl, alt: '' })
        : h('div', { class: 'loading', style: { height: '100%', padding: 0 } }, h('span', { class: 'spinner' }));
      const statusText = f.status === 'error' ? f.error : f.status === 'preparing' ? 'Preparando…' : f.status === 'uploading' ? 'Enviando…' : f.kind === 'video' && f.duration_ms ? fmt.duration(f.duration_ms) : f.width ? `${f.width}×${f.height}` : '';
      return h(
        'div',
        {
          class: `tile ${f.status === 'error' ? 'error' : ''}`,
          draggable: 'true',
          title: f.name,
          ondragstart: (e) => {
            dragKey = f.key;
            e.dataTransfer.effectAllowed = 'move';
            e.currentTarget.classList.add('dragging');
          },
          ondragend: (e) => e.currentTarget.classList.remove('dragging'),
          ondragover: (e) => {
            if (!dragKey) return;
            e.preventDefault();
            e.currentTarget.classList.add('drop-before');
          },
          ondragleave: (e) => e.currentTarget.classList.remove('drop-before'),
          ondrop: (e) => {
            e.preventDefault();
            e.stopPropagation();
            const from = S.files.findIndex((x) => x.key === dragKey);
            dragKey = null;
            if (from < 0) return;
            const [moved] = S.files.splice(from, 1);
            S.files.splice(S.files.indexOf(f), 0, moved);
            S.overrides.clear();
            paintTiles();
            refresh();
          },
        },
        preview,
        h('div', { class: 'tile-top' }, h('span', { class: 'num' }, String(i + 1)), h('button', { class: 'rm', 'aria-label': `Remover ${f.name}`, onclick: () => removeFile(f) }, icon('x', 14))),
        f.note ? h('span', { class: 'flag' }, f.note) : null,
        h('div', { class: 'tile-bot' }, h('div', { class: 'nowrap', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, statusText || f.name), f.status === 'uploading' || f.status === 'preparing' ? h('div', { class: 'prog' }, prog) : null),
      );
    };
    if (groups && groups.length > 1) {
      let i = 0;
      clear(tiles, groups.map((g, gi) => [h('div', { class: 'group-sep' }, `Carrossel ${gi + 1} · ${g.files.length} arquivo${g.files.length > 1 ? 's' : ''}`), g.files.map((f) => tileFor(f, i++))]));
    } else {
      clear(tiles, S.files.map(tileFor));
    }
    tiles.hidden = !S.files.length;
  }

  function paintMedia() {
    paintDrop();
    paintMediaHead();
    paintTiles();
  }

  function revoke(f) {
    for (const u of [f.previewUrl, f.poster]) if (u && objectUrls.has(u)) (URL.revokeObjectURL(u), objectUrls.delete(u));
  }

  function removeFile(f) {
    revoke(f);
    S.files = S.files.filter((x) => x !== f);
    S.overrides.clear();
    paintMedia();
    refresh();
  }

  function addFiles(list) {
    let skipped = 0;
    for (const file of list) {
      if (S.files.length >= MAX_FILES) {
        toast(`Limite de ${MAX_FILES} arquivos por lote.`, 'warn');
        break;
      }
      const kind = kindOf(file);
      if (!kind || (S.type === 'reels' && kind !== 'video') || (S.type === 'image' && kind !== 'image')) {
        skipped++;
        continue;
      }
      const f = { key: `f${++uid}`, name: file.name, kind, status: 'preparing', progress: 0 };
      S.files.push(f);
      queue.push(() => processFile(f, file));
    }
    if (skipped) toast(`${skipped} arquivo${skipped > 1 ? 's' : ''} ignorado${skipped > 1 ? 's' : ''}: formato não combina com ${TYPES[S.type].label}.`, 'warn');
    paintMedia();
    refresh();
    pump();
  }

  function pump() {
    while (active < UPLOAD_CONCURRENCY && queue.length) {
      active++;
      queue
        .shift()()
        .finally(() => {
          active--;
          pump();
        });
    }
  }

  async function processFile(f, file) {
    try {
      const prep = f.kind === 'image' ? await prepareImage(file, { fit: S.fit }) : await prepareVideo(file);
      if (!S.files.includes(f)) return;
      f.previewUrl = URL.createObjectURL(prep.blob);
      objectUrls.add(f.previewUrl);
      if (prep.poster) objectUrls.add((f.poster = prep.poster));
      Object.assign(f, { width: prep.width, height: prep.height, duration_ms: prep.duration_ms, note: prep.note, status: 'uploading' });
      paintTiles();
      const name = f.kind === 'image' ? file.name.replace(/\.(png|webp|heic|heif)$/i, '.jpg') : file.name;
      f.media = await api.upload(prep.blob, { name, width: f.width, height: f.height, duration_ms: f.duration_ms }, (p) => {
        f.progress = p;
        if (f.progressEl) f.progressEl.style.width = `${Math.round(p * 100)}%`;
      });
      // O servidor mede vídeos com ffprobe quando disponível; vale mais que a leitura do navegador.
      Object.assign(f, { width: f.media.width ?? f.width, height: f.media.height ?? f.height, duration_ms: f.media.duration_ms ?? f.duration_ms, status: 'done' });
    } catch (err) {
      f.status = 'error';
      f.error = err.message || 'Falha no upload';
    }
    if (!S.files.includes(f)) return;
    paintTiles();
    paintMediaHead();
    refresh();
  }

  // ---------- Seção 3: legenda ----------

  const captionBox = h('div');
  let captionInput;
  let counter;
  let spinInfo;

  function paintCounter() {
    if (!counter) return;
    const len = S.caption.length;
    const tags = hashtagCount(S.caption);
    clear(counter, h('span', { class: tags > 30 ? 'over' : '' }, `${tags}/30 hashtags`), h('span', { class: len > 2200 ? 'over' : '' }, `${fmt.number(len)}/2.200`));
    const n = countVariations(S.caption);
    clear(spinInfo, hasSpintax(S.caption) ? h('span', { class: 'tag' }, icon('shuffle', 13), `${n === Infinity ? 'milhares de' : fmt.number(n)} variações`) : null);
  }

  function paintCaption() {
    const accs = selected();
    const hasIg = !accs.length || accs.some((a) => a.platform === 'instagram');
    const hasTt = accs.some((a) => a.platform === 'tiktok');
    if (S.type === 'story') {
      clear(captionBox, h('p', { class: 'muted', style: { margin: 0 } }, 'Stories não levam legenda nem comentário: só a mídia é publicada.'));
      captionInput = counter = null;
      return;
    }
    captionInput = h('textarea', {
      class: 'input',
      rows: 6,
      placeholder: 'Escreva a legenda. Use {opção A|opção B} para cada post sair com um texto diferente.',
      value: S.caption,
      oninput: (e) => {
        S.caption = e.target.value;
        paintCounter();
        refreshSoon();
      },
    });
    counter = h('div', { class: 'counter' });
    spinInfo = h('span');
    clear(
      captionBox,
      field('Legenda', captionInput),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' } }, spinInfo, h('span', { class: 'spacer' }), counter),
      h(
        'details',
        { style: { marginTop: '8px' } },
        h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Como funcionam as variações'),
        h('p', { class: 'small muted' }, 'Escreva alternativas entre chaves, separadas por barra: "{Bom dia|Olá|E aí}, {confira|veja} a novidade". Cada post sorteia uma combinação diferente, o que evita legendas idênticas em sequência. Dá para aninhar: "{Oi|Olá {pessoal|gente}}".'),
      ),
      hasIg
        ? h(
            'div',
            { style: { marginTop: '14px' } },
            field(
              'Primeiro comentário (Instagram)',
              h('textarea', { class: 'input', rows: 2, style: { minHeight: '64px' }, placeholder: '#hashtags ou chamada para ação, publicado logo depois do post', value: S.firstComment, oninput: (e) => ((S.firstComment = e.target.value), refreshSoon()) }),
              'Bom lugar para as hashtags, sem poluir a legenda.',
            ),
          )
        : null,
      S.type === 'reels' && hasIg
        ? h('label', { class: 'check', style: { marginTop: '12px' } }, h('input', { type: 'checkbox', checked: S.shareToFeed, onchange: (e) => (S.shareToFeed = e.target.checked) }), 'Mostrar os Reels também no feed do perfil')
        : null,
      hasTt
        ? h(
            'div',
            { class: 'row', style: { marginTop: '12px' } },
            field(
              'Quem pode ver no TikTok',
              h('select', { class: 'input', onchange: (e) => (S.tiktokPrivacy = e.target.value) }, PRIVACY.map(([v, l]) => h('option', { value: v, selected: S.tiktokPrivacy === v }, l))),
              'Se a conta não permitir essa opção, o post sai como "Somente eu".',
            ),
          )
        : null,
    );
    paintCounter();
  }

  // ---------- Seção 4: horários ----------

  const whenBox = h('div');

  function paintWhen() {
    const modes = [
      ['fixed', 'Horários fixos'],
      ['interval', 'Intervalo'],
      ['now', 'Publicar agora'],
    ];
    const tabs = h('div', { class: 'segmented' }, modes.map(([m, l]) => h('button', { class: S.mode === m ? 'on' : '', onclick: () => ((S.mode = m), S.overrides.clear(), paintWhen(), refresh()) }, l)));
    let bodyEl;
    if (S.mode === 'fixed') {
      const timeInput = h('input', { class: 'input', type: 'time', style: { width: '120px', height: '32px' }, 'aria-label': 'Novo horário' });
      const addTime = () => {
        if (!timeInput.value) return;
        S.fixed.times = normalizeTimes([...S.fixed.times, timeInput.value]);
        timeInput.value = '';
        S.overrides.clear();
        paintWhen();
        refresh();
      };
      bodyEl = h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        h(
          'div',
          { class: 'row' },
          field('Começar em', h('input', { class: 'input', type: 'date', value: S.fixed.startDate, min: dateKey(Date.now()), onchange: (e) => ((S.fixed.startDate = e.target.value), S.overrides.clear(), refresh()) })),
          field(
            'Posts por dia',
            h(
              'select',
              { class: 'input', onchange: (e) => ((S.fixed.perDay = Number(e.target.value)), S.overrides.clear(), refresh()) },
              h('option', { value: '0', selected: !S.fixed.perDay }, `Um por horário (${S.fixed.times.length})`),
              Array.from({ length: Math.max(0, S.fixed.times.length - 1) }, (_, i) => i + 1).map((k) => h('option', { value: String(k), selected: S.fixed.perDay === k }, `${k} por dia`)),
            ),
          ),
        ),
        h(
          'div',
          h('div', { class: 'label-text', style: { marginBottom: '8px' } }, 'Horários do dia'),
          h(
            'div',
            { class: 'time-chips' },
            S.fixed.times.map((t) =>
              h('span', { class: 'chip', style: { paddingLeft: '12px', cursor: 'default' } }, t, h('button', { class: 'btn ghost icon sm', style: { width: '20px', height: '20px' }, 'aria-label': `Remover ${t}`, onclick: () => ((S.fixed.times = S.fixed.times.filter((x) => x !== t)), (S.fixed.perDay = 0), S.overrides.clear(), paintWhen(), refresh()) }, icon('x', 12))),
            ),
            timeInput,
            h('button', { class: 'btn sm', onclick: addTime }, icon('plus', 14), 'Adicionar'),
            h('button', { class: 'btn ghost sm', onclick: () => ((S.fixed.times = [...SUGGESTED_TIMES]), (S.fixed.perDay = 0), S.overrides.clear(), paintWhen(), refresh()) }, icon('wand', 14), 'Usar sugestão'),
          ),
        ),
        weekdayPicker(S.fixed),
      );
      timeInput.addEventListener('keydown', (e) => e.key === 'Enter' && addTime());
    } else if (S.mode === 'interval') {
      bodyEl = h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        h(
          'div',
          { class: 'row' },
          field('Primeiro post', h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(S.interval.start), onchange: (e) => ((S.interval.start = fromLocalInput(e.target.value)), S.overrides.clear(), refresh()) })),
          field(
            'Um post a cada',
            h('select', { class: 'input', onchange: (e) => ((S.interval.every = Number(e.target.value)), S.overrides.clear(), refresh()) }, [15, 30, 45, 60, 90, 120, 180, 240, 360, 480, 720, 1440].map((m) => h('option', { value: String(m), selected: S.interval.every === m }, m < 60 ? `${m} min` : m === 1440 ? '24 h' : `${m / 60} h`))),
          ),
          field('Das', h('input', { class: 'input', type: 'time', value: S.interval.from, onchange: (e) => ((S.interval.from = e.target.value), S.overrides.clear(), refresh()) })),
          field('Até', h('input', { class: 'input', type: 'time', value: S.interval.to, onchange: (e) => ((S.interval.to = e.target.value), S.overrides.clear(), refresh()) })),
        ),
        h('p', { class: 'muted small', style: { margin: 0 } }, 'Fora da janela, o próximo post pula para o início dela no dia seguinte.'),
      );
    } else {
      bodyEl = h('p', { class: 'muted', style: { margin: 0 } }, 'Os posts entram na fila imediatamente e saem em sequência, em poucos segundos.');
    }
    clear(whenBox, tabs, h('div', { style: { marginTop: '16px' } }, bodyEl));
  }

  function weekdayPicker(target) {
    return h(
      'div',
      h('div', { class: 'label-text', style: { marginBottom: '8px' } }, 'Dias da semana'),
      h(
        'div',
        { class: 'weekdays' },
        WEEKDAYS.map((d, i) =>
          h(
            'button',
            {
              class: target.weekdays.includes(i) ? 'on' : '',
              title: ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'][i],
              onclick: (e) => {
                const has = target.weekdays.includes(i);
                if (has && target.weekdays.length === 1) return;
                target.weekdays = has ? target.weekdays.filter((x) => x !== i) : [...target.weekdays, i];
                e.currentTarget.classList.toggle('on', !has);
                S.overrides.clear();
                refresh();
              },
            },
            d,
          ),
        ),
      ),
    );
  }

  // ---------- Revisão e envio ----------

  const planBox = h('div');
  const dock = h('div', { class: 'dock' });

  function editCaption(item) {
    const ta = h('textarea', { class: 'input', rows: 8, value: item.caption });
    const m = openModal({
      title: 'Legenda deste post',
      body: h('div', field('Legenda', ta, 'Vale só para este post. As demais continuam seguindo o texto principal.')),
      foot: [
        h('button', { class: 'btn ghost', onclick: () => { const o = S.overrides.get(item.key) || {}; delete o.caption; S.overrides.set(item.key, o); m.close(); refresh(); } }, 'Voltar ao texto principal'),
        h('button', { class: 'btn primary', onclick: () => { S.overrides.set(item.key, { ...S.overrides.get(item.key), caption: ta.value }); m.close(); refresh(); } }, 'Salvar'),
      ],
    });
  }

  function paintPlan(rows) {
    if (!rows.length) {
      clear(planBox, h('p', { class: 'muted', style: { margin: 0 } }, 'Os posts aparecem aqui assim que você enviar as mídias.'));
      return;
    }
    const accs = selected();
    const warnings = [];
    if (accs.length && S.mode !== 'now') {
      const ts = rows.map((r) => r.at).filter(Boolean);
      for (const a of accs) {
        const peak = maxInWindow(ts);
        if (peak > PLATFORMS[a.platform].perDay) warnings.push(`@${a.username} receberia ${peak} posts em 24h; o máximo seguro no ${PLATFORM_LABEL[a.platform]} é ${PLATFORMS[a.platform].perDay}.`);
        else if (peak > RECOMMENDED_PER_DAY) warnings.push(`@${a.username}: ${peak} posts em 24h. Acima de ${RECOMMENDED_PER_DAY} por dia o alcance costuma cair.`);
      }
    }
    const first = rows.find((r) => r.at)?.at;
    const last = [...rows].reverse().find((r) => r.at)?.at;
    const showComment = S.type !== 'story' && hasSpintax(S.firstComment);
    clear(
      planBox,
      h(
        'div',
        { class: 'row', style: { justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' } },
        h('div', { class: 'muted' }, first ? (S.mode === 'now' ? `${rows.length} posts para agora` : `${rows.length} posts de ${fmt.dateTime(first)} a ${fmt.dateTime(last)}`) : ''),
        hasSpintax(S.caption) || hasSpintax(S.firstComment) ? h('button', { class: 'btn sm', onclick: () => ((S.seed += 1), refresh()) }, icon('shuffle', 14), 'Sortear variações de novo') : null,
      ),
      [...new Set(warnings)].map((w) => h('div', { class: 'alert warn' }, icon('alert'), h('div', { class: 'grow' }, w))),
      h(
        'div',
        { class: 'table-wrap' },
        h(
          'table',
          { class: 'plan-table' },
          h('thead', h('tr', h('th', '#'), h('th', 'Mídia'), h('th', S.type === 'story' ? '' : 'Legenda'), h('th', 'Quando'), h('th', ''))),
          h(
            'tbody',
            rows.map((r, i) =>
              h(
                'tr',
                { class: r.issues.length ? 'bad' : '' },
                h('td', { class: 'muted' }, String(i + 1)),
                h('td', h('div', { class: 'thumbs' }, r.files.slice(0, 4).map((f) => {
                  const src = f.poster || (f.kind === 'image' ? f.previewUrl : null);
                  return h('div', { class: 'thumb' }, src ? h('img', { src, alt: '' }) : icon(f.kind === 'video' ? 'video' : 'image', 14));
                }), r.files.length > 4 ? h('span', { class: 'tag' }, `+${r.files.length - 4}`) : null)),
                h(
                  'td',
                  { style: { maxWidth: '360px' } },
                  S.type === 'story' ? null : h('div', { class: 'clamp-2 pre small' }, r.caption || h('span', { class: 'faint' }, 'Sem legenda')),
                  showComment && r.firstComment ? h('div', { class: 'small faint clamp-2' }, `Comentário: ${r.firstComment}`) : null,
                  r.issues.length ? h('div', { class: 'small', style: { color: 'var(--err)', marginTop: '4px' } }, r.issues.join(' · ')) : null,
                ),
                h(
                  'td',
                  S.mode === 'now'
                    ? h('span', { class: 'muted' }, 'Agora')
                    : h('input', {
                        class: 'input',
                        type: 'datetime-local',
                        value: r.at ? toLocalInput(r.at) : '',
                        'aria-label': `Data e hora do post ${i + 1}`,
                        onchange: (e) => {
                          const at = fromLocalInput(e.target.value);
                          S.overrides.set(r.key, { ...S.overrides.get(r.key), at: Number.isFinite(at) ? at : undefined });
                          refresh();
                        },
                      }),
                ),
                h(
                  'td',
                  { class: 'nowrap' },
                  S.type !== 'story' ? h('button', { class: 'btn ghost icon sm', title: 'Editar legenda deste post', 'aria-label': 'Editar legenda', onclick: () => editCaption(r) }, icon('edit', 15)) : null,
                  h('button', { class: 'btn ghost icon sm', title: 'Tirar do lote', 'aria-label': 'Remover post', onclick: () => r.files.forEach(removeFile) }, icon('trash', 15)),
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function paintDock(rows) {
    const accs = selected();
    const total = rows.length * accs.length;
    const busy = S.files.some((f) => f.status === 'preparing' || f.status === 'uploading');
    const bad = rows.filter((r) => r.issues.length).length;
    const usage = store.me?.usage;
    const left = usage ? usage.limit - usage.used : Infinity;
    let reason = '';
    if (!accs.length) reason = 'Escolha pelo menos uma conta.';
    else if (!rows.length) reason = 'Envie as mídias.';
    else if (busy) reason = 'Esperando os uploads terminarem…';
    else if (bad) reason = `${bad} post${bad > 1 ? 's' : ''} com problema (veja em vermelho).`;
    else if (total > left) reason = `Passa do limite do plano: restam ${left} posts neste mês.`;

    clear(
      dock,
      h(
        'div',
        { class: 'dock-inner' },
        h(
          'div',
          { class: 'summary' },
          h('b', total ? `${rows.length} post${rows.length > 1 ? 's' : ''} × ${accs.length} conta${accs.length > 1 ? 's' : ''} = ${total} publicaç${total > 1 ? 'ões' : 'ão'}` : 'Nada para agendar ainda'),
          h('div', { class: 'small muted' }, reason || (usage ? `Depois disso: ${usage.used + total} de ${usage.limit} no mês.` : '')),
        ),
        h(
          'button',
          { class: 'btn primary lg', disabled: Boolean(reason) || S.sending, onclick: () => submit(rows) },
          S.sending ? h('span', { class: 'spinner', style: { borderTopColor: '#fff' } }) : icon(S.mode === 'now' ? 'bolt' : 'calendar', 18),
          S.mode === 'now' ? `Publicar ${total || ''} agora` : `Agendar ${total || ''}`,
        ),
      ),
    );
  }

  async function submit(rows) {
    S.sending = true;
    paintDock(rows);
    try {
      const out = await api.post('/api/posts/batch', {
        account_ids: [...S.accountIds],
        type: S.type,
        publish_now: S.mode === 'now',
        options: { share_to_feed: S.shareToFeed, tiktok_privacy: S.tiktokPrivacy },
        items: rows.map((r) => ({ media_ids: r.files.map((f) => f.media.id), caption: S.type === 'story' ? '' : r.caption, first_comment: S.type === 'story' ? '' : r.firstComment, scheduled_at: r.at })),
      });
      await store.loadMe().catch(() => {});
      for (const w of out.warnings || []) toast(w, 'warn', 8000);
      S.files.forEach(revoke);
      S.files = [];
      S.caption = '';
      S.firstComment = '';
      S.overrides.clear();
      S.sending = false;
      paintMedia();
      paintCaption();
      refresh();
      const m = openModal({
        title: S.mode === 'now' ? 'Enviado para publicação' : 'Tudo agendado',
        body: emptyState({ iconName: 'check', title: `${out.created} publicaç${out.created > 1 ? 'ões' : 'ão'} na fila`, text: S.mode === 'now' ? 'Acompanhe o resultado no histórico em alguns segundos.' : 'O FlyPost publica sozinho nos horários marcados. Você pode editar ou cancelar pelo calendário.' }),
        foot: [h('a', { class: 'btn', href: S.mode === 'now' ? '#/historico' : '#/calendario', onclick: () => m.close() }, S.mode === 'now' ? 'Ver histórico' : 'Ver calendário'), h('button', { class: 'btn primary', onclick: () => m.close() }, 'Agendar mais')],
      });
    } catch (err) {
      S.sending = false;
      refresh();
      const list = err.details?.errors || [];
      const m = openModal({
        title: 'Não deu para agendar',
        body: h('div', h('p', { style: { marginTop: 0 } }, err.message), list.length > 1 ? h('ul', { class: 'small muted' }, list.map((e) => h('li', e))) : null),
        foot: [h('button', { class: 'btn primary', onclick: () => m.close() }, 'Entendi')],
      });
    }
  }

  // ---------- Montagem ----------

  let pending = null;
  function refreshSoon() {
    clearTimeout(pending);
    pending = setTimeout(refresh, 250);
  }
  function refresh() {
    const rows = plan();
    paintPlan(rows);
    paintDock(rows);
  }
  function paintAll() {
    paintTarget();
    paintMedia();
    paintCaption();
    paintWhen();
    refresh();
  }

  const section = (n, title, ...body) => h('section', { class: 'card' }, h('h2', { class: 'section-title' }, h('span', { class: 'step-num' }, String(n)), title), ...body);

  root.append(
    h('div', { class: 'page-head' }, h('div', h('h1', 'Agendar posts'), h('p', 'Envie as mídias, escreva a legenda e deixe o FlyPost distribuir os horários.'))),
    h(
      'div',
      { class: 'composer' },
      section(1, 'Onde e o quê', typeBox, accountsBox),
      section(2, 'Mídias', mediaHead, drop, fileInput, tiles),
      section(3, 'Legenda', captionBox),
      section(4, 'Quando', whenBox),
      section(5, 'Revisão', planBox),
    ),
    dock,
  );

  const firstUsable = accounts().filter(usable);
  if (firstUsable.length === 1) S.accountIds.add(firstUsable[0].id);
  paintAll();

  const beforeUnload = (e) => {
    if (S.files.length) e.preventDefault();
  };
  window.addEventListener('beforeunload', beforeUnload);
  return () => {
    window.removeEventListener('beforeunload', beforeUnload);
    S.files.forEach(revoke);
    clearTimeout(pending);
  };
}
