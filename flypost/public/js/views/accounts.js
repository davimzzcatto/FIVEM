import { api } from '../api.js';
import { store } from '../store.js';
import { h, clear, icon, toast, openModal, confirmDialog, avatar, accountBadge, field, fmt, emptyState, codeBlock, PLATFORM_LABEL } from '../ui.js';

const COLORS = ['#FF5A1F', '#2E90FA', '#12B76A', '#F79009', '#9E77ED', '#EE46BC', '#15B79E', '#667085'];
const CONNECT = [
  ['instagram', 'Instagram', 'Perfil profissional (comercial ou criador). Login direto pelo Instagram.'],
  ['facebook', 'Facebook', 'Páginas que você administra.'],
  ['tiktok', 'TikTok', 'Publica vídeos direto no perfil.'],
];
const ENV = {
  instagram: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
  facebook: ['META_APP_ID', 'META_APP_SECRET'],
  tiktok: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
};

export async function render(root, { query, go }) {
  const body = h('div');
  root.append(
    h(
      'div',
      { class: 'page-head' },
      h('div', h('h1', 'Contas e marcas'), h('p', 'Cada marca agrupa as contas de um cliente ou projeto. Um mesmo lote pode ir para várias marcas.')),
      h('div', { class: 'actions' }, h('button', { class: 'btn', onclick: newWorkspace }, icon('plus', 16), 'Nova marca')),
    ),
    body,
  );

  // Retorno do login nas redes (?ok=, ?erro=, ?escolher=)
  if (query.ok) toast(`Conta @${query.ok} conectada.`);
  if (query.erro) toast(query.erro, 'err', 9000);
  if (query.ok || query.erro) history.replaceState(null, '', '#/contas');
  if (query.escolher) {
    history.replaceState(null, '', '#/contas');
    pickPages(query.escolher);
  }

  async function reload() {
    await store.loadWorkspaces();
    paint();
  }

  function paint() {
    clear(body, store.workspaces.map(workspaceCard));
  }

  function workspaceCard(w) {
    return h(
      'section',
      { class: 'card' },
      h(
        'div',
        { class: 'card-head' },
        h('h2', { style: { display: 'flex', alignItems: 'center', gap: '10px' } }, h('span', { style: { width: '12px', height: '12px', borderRadius: '4px', background: w.color } }), w.name, h('span', { class: 'muted small', style: { fontWeight: 500 } }, `${w.accounts.length} conta${w.accounts.length === 1 ? '' : 's'}`)),
        h(
          'div',
          { class: 'actions' },
          h('button', { class: 'btn ghost sm', onclick: () => editWorkspace(w) }, icon('edit', 14), 'Editar'),
          store.workspaces.length > 1 ? h('button', { class: 'btn ghost sm', onclick: () => deleteWorkspace(w) }, icon('trash', 14), 'Excluir') : null,
        ),
      ),
      w.accounts.length ? h('div', { class: 'list' }, w.accounts.map((a) => accountRow(a, w))) : h('p', { class: 'muted', style: { marginTop: 0 } }, 'Nenhuma conta nesta marca ainda.'),
      h('div', { class: 'divider' }),
      h(
        'div',
        { class: 'actions' },
        h('span', { class: 'muted small', style: { marginRight: '4px' } }, 'Conectar:'),
        CONNECT.map(([p, label]) => h('button', { class: 'btn sm', onclick: () => connect(p, w.id) }, h('span', { class: `pf pf-${p}` }, icon(p, 12)), label)),
        h('button', { class: 'btn ghost sm', onclick: () => addTestAccount(w) }, icon('bolt', 14), 'Conta de teste'),
      ),
    );
  }

  function accountRow(a, w) {
    const sim = a.mode === 'simulated';
    const expiry = a.token_expires_at && a.platform === 'instagram' ? `acesso renovado automaticamente · vence ${fmt.date(a.token_expires_at)}` : null;
    return h(
      'div',
      { class: 'list-item' },
      avatar(a, 'lg'),
      h(
        'div',
        { class: 'grow' },
        h('div', { class: 'title' }, `@${a.username}`, ' ', sim ? h('span', { class: 'badge b-sim plain' }, 'teste') : null),
        h('div', { class: 'meta' }, [PLATFORM_LABEL[a.platform], a.display_name && a.display_name !== a.username ? a.display_name : null, expiry].filter(Boolean).join(' · ')),
        a.status === 'expired' && a.status_detail ? h('div', { class: 'small', style: { color: 'var(--err)' } }, a.status_detail) : null,
      ),
      accountBadge(a),
      h(
        'div',
        { class: 'actions' },
        a.status === 'expired' && !sim ? h('button', { class: 'btn primary sm', onclick: () => connect(a.platform, w.id) }, icon('refresh', 14), 'Reconectar') : null,
        h('button', { class: 'btn ghost icon sm', title: 'Opções', 'aria-label': `Opções de @${a.username}`, onclick: () => accountMenu(a, w) }, icon('sliders', 16)),
      ),
    );
  }

  async function connect(platform, workspaceId) {
    if (!store.me?.integrations?.[platform]) {
      const [idVar, secretVar] = ENV[platform];
      const m = openModal({
        title: `Conectar ${PLATFORM_LABEL[platform]}`,
        body: h(
          'div',
          h('p', { style: { marginTop: 0 } }, `A integração com o ${PLATFORM_LABEL[platform]} ainda não foi configurada neste servidor. Quem administra o FlyPost precisa criar o app na plataforma e preencher no arquivo .env:`),
          codeBlock(`${idVar}=...\n${secretVar}=...`),
          h('p', { class: 'muted small' }, 'O passo a passo está no README do projeto. Enquanto isso, dá para testar todo o fluxo com uma conta de teste.'),
        ),
        foot: [h('button', { class: 'btn', onclick: () => m.close() }, 'Fechar'), h('button', { class: 'btn primary', onclick: () => (m.close(), addTestAccount(store.workspaceOf(workspaceId), platform)) }, 'Criar conta de teste')],
      });
      return;
    }
    try {
      const { url } = await api.get(`/api/oauth/${platform}/start`, { workspace_id: workspaceId });
      location.href = url;
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  function addTestAccount(w, platform = 'instagram') {
    const plat = h('select', { class: 'input' }, CONNECT.map(([p, l]) => h('option', { value: p, selected: p === platform }, l)));
    const user = h('input', { class: 'input', placeholder: 'loja_exemplo', maxlength: 40 });
    const m = openModal({
      title: 'Conta de teste',
      body: h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        h('p', { class: 'muted', style: { margin: 0 } }, 'Funciona como uma conta de verdade (fila, horários, histórico, webhooks), mas nada é enviado para a rede social. Para simular erro, escreva [falhar] na legenda; para simular instabilidade, [instavel].'),
        field('Rede', plat),
        field('Nome de usuário', user),
      ),
      foot: [
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancelar'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                await api.post('/api/accounts/simulated', { workspace_id: w.id, platform: plat.value, username: user.value });
                m.close();
                toast('Conta de teste criada.');
                reload();
              } catch (err) {
                toast(err.message, 'err');
                btn.disabled = false;
              }
            },
          },
          'Criar',
        ),
      ],
    });
  }

  function accountMenu(a, w) {
    const moveSel =
      store.workspaces.length > 1
        ? h('select', { class: 'input' }, store.workspaces.map((x) => h('option', { value: String(x.id), selected: x.id === w.id }, x.name)))
        : null;
    const privacy =
      a.platform === 'tiktok'
        ? h(
            'select',
            { class: 'input' },
            [
              ['PUBLIC_TO_EVERYONE', 'Público'],
              ['FOLLOWER_OF_CREATOR', 'Seguidores'],
              ['MUTUAL_FOLLOW_FRIENDS', 'Amigos'],
              ['SELF_ONLY', 'Somente eu'],
            ].map(([v, l]) => h('option', { value: v, selected: (a.settings?.tiktok_privacy || 'PUBLIC_TO_EVERYONE') === v }, l)),
          )
        : null;
    const m = openModal({
      title: `@${a.username}`,
      body: h(
        'div',
        { style: { display: 'grid', gap: '14px' } },
        moveSel ? field('Marca', moveSel) : null,
        privacy ? field('Privacidade padrão no TikTok', privacy, 'Usada quando o post não define outra.') : null,
        a.status !== 'expired'
          ? h('label', { class: 'check' }, h('input', { type: 'checkbox', id: 'acc-active', checked: a.status === 'active' }), 'Conta ativa (desativada, os posts dela ficam em espera e falham depois de 1h)')
          : h('div', { class: 'alert err', style: { margin: 0 } }, icon('alert'), h('div', { class: 'grow' }, 'Esta conta perdeu o acesso. Reconecte para voltar a publicar.')),
      ),
      foot: [
        h(
          'button',
          {
            class: 'btn danger',
            onclick: async () => {
              if (!(await confirmDialog({ title: `Remover @${a.username}?`, message: 'Os posts agendados desta conta serão apagados. O histórico de publicações continua no Histórico.', confirmText: 'Remover', danger: true }))) return;
              try {
                await api.del(`/api/accounts/${a.id}`);
                m.close();
                toast('Conta removida.');
                reload();
              } catch (err) {
                toast(err.message, 'err');
              }
            },
          },
          'Remover conta',
        ),
        h('span', { class: 'spacer' }),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              const patch = {};
              if (moveSel && Number(moveSel.value) !== w.id) patch.workspace_id = Number(moveSel.value);
              if (privacy) patch.settings = { tiktok_privacy: privacy.value };
              const active = m.modal.querySelector('#acc-active');
              if (active) patch.status = active.checked ? 'active' : 'disabled';
              try {
                await api.patch(`/api/accounts/${a.id}`, patch);
                m.close();
                toast('Conta atualizada.');
                reload();
              } catch (err) {
                toast(err.message, 'err');
              }
            },
          },
          'Salvar',
        ),
      ],
    });
  }

  function workspaceForm(w, onSave) {
    const name = h('input', { class: 'input', value: w?.name || '', maxlength: 60, placeholder: 'Ex.: Loja Centro, Cliente Acme' });
    let color = w?.color || COLORS[store.workspaces.length % COLORS.length];
    const swatches = h('div', { class: 'chips' });
    const paintSwatches = () =>
      clear(
        swatches,
        COLORS.map((c) => h('button', { 'aria-label': `Cor ${c}`, style: { width: '28px', height: '28px', borderRadius: '8px', border: c === color ? '2px solid var(--text)' : '2px solid transparent', background: c, cursor: 'pointer' }, onclick: () => ((color = c), paintSwatches()) })),
      );
    paintSwatches();
    const m = openModal({
      title: w ? 'Editar marca' : 'Nova marca',
      body: h('div', { style: { display: 'grid', gap: '14px' } }, field('Nome', name), h('div', h('div', { class: 'label-text', style: { marginBottom: '8px' } }, 'Cor'), swatches)),
      foot: [
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancelar'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                await onSave({ name: name.value, color });
                m.close();
                reload();
              } catch (err) {
                toast(err.message, 'err');
              }
            },
          },
          'Salvar',
        ),
      ],
    });
  }

  function newWorkspace() {
    workspaceForm(null, (data) => api.post('/api/workspaces', data).then(() => toast('Marca criada.')));
  }
  function editWorkspace(w) {
    workspaceForm(w, (data) => api.patch(`/api/workspaces/${w.id}`, data).then(() => toast('Marca atualizada.')));
  }
  async function deleteWorkspace(w) {
    const ok = await confirmDialog({ title: `Excluir a marca ${w.name}?`, message: 'As contas desta marca e todos os posts dela serão removidos.', confirmText: 'Excluir marca', danger: true, typeToConfirm: w.name });
    if (!ok) return;
    try {
      await api.del(`/api/workspaces/${w.id}`);
      toast('Marca excluída.');
      reload();
    } catch (err) {
      toast(err.message, 'err');
    }
  }

  // Facebook: depois do login, a pessoa escolhe quais Páginas viram contas.
  async function pickPages(state) {
    let data;
    try {
      data = await api.get(`/api/oauth/pending/${encodeURIComponent(state)}`);
    } catch (err) {
      toast(err.message, 'err');
      return;
    }
    const chosen = new Set(data.pages.filter((p) => !p.connected).map((p) => p.id));
    const list = h(
      'div',
      { class: 'list' },
      data.pages.map((p) =>
        h(
          'label',
          { class: 'list-item', style: { cursor: 'pointer' } },
          h('input', { type: 'checkbox', checked: chosen.has(p.id), onchange: (e) => (e.target.checked ? chosen.add(p.id) : chosen.delete(p.id)), style: { accentColor: 'var(--brand)', width: '16px', height: '16px' } }),
          avatar({ display_name: p.name, avatar_url: p.avatar_url, platform: 'facebook' }),
          h('div', { class: 'grow' }, h('div', { class: 'title' }, p.name), p.connected ? h('div', { class: 'meta' }, 'Já conectada (será atualizada)') : null),
        ),
      ),
    );
    const m = openModal({
      title: 'Quais Páginas conectar?',
      body: data.pages.length ? list : emptyState({ title: 'Nenhuma Página', text: 'Esta conta do Facebook não administra Páginas com permissão para publicar.' }),
      foot: [
        h('button', { class: 'btn ghost', onclick: () => m.close() }, 'Cancelar'),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: async () => {
              try {
                const r = await api.post(`/api/oauth/pending/${encodeURIComponent(state)}`, { page_ids: [...chosen] });
                m.close();
                toast(`${r.connected} Página${r.connected > 1 ? 's' : ''} conectada${r.connected > 1 ? 's' : ''}.`);
                reload();
              } catch (err) {
                toast(err.message, 'err');
              }
            },
          },
          'Conectar selecionadas',
        ),
      ],
    });
  }

  await reload();
  void go;
}
