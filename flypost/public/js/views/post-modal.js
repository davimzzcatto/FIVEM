import { api } from '../api.js';
import { h, clear, icon, openModal, confirmDialog, toast, fmt, statusBadge, avatar, field, toLocalInput, fromLocalInput, PLATFORM_LABEL, loading } from '../ui.js';
import { TYPES } from '../../lib/rules.js';

const EDITABLE = ['scheduled', 'failed', 'draft'];

// Detalhe de um post, com edição e ações. onChange é chamado depois de qualquer alteração.
export async function openPost(id, { onChange } = {}) {
  const m = openModal({ title: 'Post', body: loading(), wide: true });
  let post;
  try {
    post = await api.get(`/api/posts/${id}`);
  } catch (err) {
    clear(m.body, h('div', { class: 'alert err' }, icon('alert'), h('div', { class: 'grow' }, err.message)));
    return;
  }

  const done = async (msg) => {
    toast(msg);
    m.close();
    onChange?.();
  };
  // O botão é capturado antes de qualquer await: depois dele, e.currentTarget vira null.
  const run = async (btn, fn, msg) => {
    btn.disabled = true;
    try {
      await fn();
      await done(msg);
    } catch (err) {
      toast(err.message, 'err');
      btn.disabled = false;
    }
  };
  const act = (fn, msg) => (e) => run(e.currentTarget, fn, msg);

  // Mídia
  const stage = h('div', { class: 'post-media' });
  const showMedia = (item) => {
    if (!item || item.missing) return clear(stage, h('div', { class: 'empty' }, 'Mídia indisponível'));
    clear(stage, item.kind === 'video' ? h('video', { src: item.url, controls: true, playsinline: true, preload: 'metadata' }) : h('img', { src: item.url, alt: '' }));
  };
  showMedia(post.media[0]);
  const strip =
    post.media.length > 1
      ? h(
          'div',
          { class: 'post-strip' },
          post.media.map((item, i) => {
            const t = h('div', { class: `thumb ${i === 0 ? 'on' : ''}`, onclick: () => {
              strip.querySelectorAll('.thumb').forEach((x) => x.classList.remove('on'));
              t.classList.add('on');
              showMedia(item);
            } }, item.kind === 'video' ? h('video', { src: `${item.url}#t=0.5`, muted: true, preload: 'metadata' }) : h('img', { src: item.url, alt: '' }));
            return t;
          }),
        )
      : null;

  const acc = post.account || {};
  const info = h(
    'dl',
    { class: 'kv' },
    h('dt', 'Tipo'),
    h('dd', TYPES[post.type]?.label || post.type),
    h('dt', 'Agendado'),
    h('dd', fmt.full(post.scheduled_at), ' ', h('span', { class: 'faint' }, `(${fmt.relative(post.scheduled_at)})`)),
    post.published_at ? [h('dt', 'Publicado'), h('dd', fmt.full(post.published_at))] : null,
    post.attempts ? [h('dt', 'Tentativas'), h('dd', String(post.attempts))] : null,
    post.next_attempt_at && post.status === 'scheduled' ? [h('dt', 'Nova tentativa'), h('dd', fmt.full(post.next_attempt_at))] : null,
    h('dt', 'Origem'),
    h('dd', post.source === 'api' ? 'API' : 'Painel'),
  );

  const errorBox = post.last_error
    ? h('div', { class: `alert ${post.status === 'failed' ? 'err' : 'warn'}` }, icon('alert'), h('div', { class: 'grow' }, h('b', post.status === 'failed' ? 'Motivo da falha: ' : 'Última tentativa: '), post.last_error))
    : null;

  // Edição
  const editable = EDITABLE.includes(post.status);
  const caption = h('textarea', { class: 'input', rows: 6, value: post.caption, disabled: !editable });
  const comment = h('textarea', { class: 'input', rows: 2, value: post.first_comment || '', disabled: !editable, style: { minHeight: '60px' } });
  const when = h('input', { class: 'input', type: 'datetime-local', value: toLocalInput(post.scheduled_at), disabled: !editable });

  const save = h(
    'button',
    {
      class: 'btn primary',
      onclick: act(async () => {
        const at = fromLocalInput(when.value);
        const body = { caption: caption.value, first_comment: comment.value };
        if (at !== fromLocalInput(toLocalInput(post.scheduled_at))) body.scheduled_at = at;
        const r = await api.patch(`/api/posts/${post.id}`, body);
        for (const w of r.warnings || []) toast(w, 'warn', 7000);
      }, 'Alterações salvas.'),
    },
    'Salvar',
  );

  const buttons = [];
  if (post.permalink) buttons.push(h('a', { class: 'btn', href: post.permalink, target: '_blank', rel: 'noopener' }, icon('external', 16), `Ver no ${PLATFORM_LABEL[acc.platform] || 'perfil'}`));
  if (post.status === 'scheduled') {
    buttons.push(h('button', { class: 'btn', onclick: act(() => api.post(`/api/posts/${post.id}/publish-now`), 'Enviado para publicação agora.') }, icon('bolt', 16), 'Publicar agora'));
    buttons.push(
      h('button', {
        class: 'btn danger',
        onclick: async (e) => {
          const btn = e.currentTarget;
          if (await confirmDialog({ title: 'Cancelar este post?', message: 'Ele sai da fila e não será publicado. Dá para excluir depois.', confirmText: 'Cancelar post', danger: true })) {
            run(btn, () => api.post(`/api/posts/${post.id}/cancel`), 'Post cancelado.');
          }
        },
      }, 'Cancelar post'),
    );
  }
  if (post.status === 'failed') buttons.push(h('button', { class: 'btn', onclick: act(() => api.post(`/api/posts/${post.id}/retry`), 'Nova tentativa em andamento.') }, icon('refresh', 16), 'Tentar de novo'));
  if (post.status !== 'publishing') {
    buttons.push(
      h('button', {
        class: 'btn ghost',
        onclick: async (e) => {
          const btn = e.currentTarget;
          const msg = post.status === 'published' ? 'O post some do FlyPost, mas continua no perfil da rede social.' : 'Essa ação não pode ser desfeita.';
          if (await confirmDialog({ title: 'Excluir post?', message: msg, confirmText: 'Excluir', danger: true })) run(btn, () => api.del(`/api/posts/${post.id}`), 'Post excluído.');
        },
      }, icon('trash', 16), 'Excluir'),
    );
  }

  clear(
    m.body,
    h(
      'div',
      { class: 'post-view' },
      h('div', stage, strip),
      h(
        'div',
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
          avatar(acc),
          h('div', { class: 'grow', style: { minWidth: 0 } }, h('div', { style: { fontWeight: 650 } }, `@${acc.username || '—'}`), h('div', { class: 'muted small' }, PLATFORM_LABEL[acc.platform] || '')),
          statusBadge(post.status),
        ),
        info,
        errorBox,
        h('div', { style: { display: 'grid', gap: '12px' } }, field('Legenda', caption), post.type !== 'story' && acc.platform === 'instagram' ? field('Primeiro comentário', comment) : null, field('Data e hora', when)),
      ),
    ),
  );
  m.setFoot([...buttons, h('span', { class: 'spacer' }), editable ? save : h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar')]);
}
