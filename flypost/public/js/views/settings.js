import { api } from '../api.js';
import { store, readTheme, saveTheme } from '../store.js';
import { h, clear, icon, toast, openModal, confirmDialog, field, fmt, codeBlock, copyText, loading } from '../ui.js';

const EVENTS = [
  ['post.published', 'Post publicado'],
  ['post.failed', 'Post falhou'],
  ['account.expired', 'Conta precisa reconectar'],
];

function device(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|node|python/i.test(ua) ? 'Script' : 'Navegador';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} · ${os}` : browser;
}

export async function render(root) {
  const nav = [
    ['perfil', 'Perfil'],
    ['seguranca', 'Segurança'],
    ['plano', 'Plano e uso'],
    ['chaves', 'Chaves de API'],
    ['webhooks', 'Webhooks'],
    ['aparencia', 'Aparência'],
    ['perigo', 'Excluir conta'],
  ];
  const content = h('div');
  root.append(
    h('div', { class: 'page-head' }, h('div', h('h1', 'Configurações'), h('p', 'Seu perfil, segurança, plano e integrações.'))),
    h(
      'div',
      { class: 'settings' },
      h('nav', { class: 'settings-nav' }, nav.map(([id, l]) => h('a', { href: `#/configuracoes`, onclick: (e) => (e.preventDefault(), document.getElementById(`s-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })) }, l))),
      content,
    ),
  );
  const card = (id, title, sub, ...body) => h('section', { class: 'card', id: `s-${id}`, style: { scrollMarginTop: '20px' } }, h('div', { class: 'card-head' }, h('div', h('h2', title), sub ? h('div', { class: 'sub' }, sub) : null)), ...body);

  // ---------- Perfil ----------
  const me = store.me.user;
  const name = h('input', { class: 'input', value: me.name, autocomplete: 'name' });
  const email = h('input', { class: 'input', type: 'email', value: me.email, autocomplete: 'email' });
  const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [me.timezone];
  const tz = h('select', { class: 'input' }, (zones.includes(me.timezone) ? zones : [me.timezone, ...zones]).map((z) => h('option', { value: z, selected: z === me.timezone }, z.replace(/_/g, ' '))));
  const profile = card(
    'perfil',
    'Perfil',
    null,
    h('div', { class: 'row' }, field('Nome', name), field('E-mail', email)),
    h('div', { class: 'row', style: { marginTop: '12px' } }, field('Fuso horário', tz, 'Usado para contar o limite do mês e nas análises.')),
    h(
      'div',
      { class: 'actions', style: { marginTop: '14px' } },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            try {
              await api.patch('/api/me', { name: name.value, email: email.value, timezone: tz.value });
              await store.loadMe();
              toast('Perfil salvo.');
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        'Salvar perfil',
      ),
    ),
  );

  // ---------- Segurança ----------
  const cur = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const next = h('input', { class: 'input', type: 'password', autocomplete: 'new-password', minlength: 8 });
  const again = h('input', { class: 'input', type: 'password', autocomplete: 'new-password' });
  const sessions = h('div', loading());
  async function loadSessions() {
    const list = await api.get('/api/me/sessions');
    clear(
      sessions,
      h(
        'div',
        { class: 'list' },
        list.map((s) =>
          h(
            'div',
            { class: 'list-item' },
            h('div', { class: 'grow' }, h('div', { class: 'title' }, device(s.user_agent), ' ', s.current ? h('span', { class: 'badge b-active' }, 'esta sessão') : null), h('div', { class: 'meta' }, `${s.ip || 'IP desconhecido'} · ativa ${fmt.relative(s.last_seen_at)} · desde ${fmt.date(s.created_at)}`)),
            s.current
              ? null
              : h(
                  'button',
                  {
                    class: 'btn ghost sm',
                    onclick: async () => {
                      await api.del(`/api/me/sessions/${s.id}`);
                      toast('Sessão encerrada.');
                      loadSessions();
                    },
                  },
                  'Encerrar',
                ),
          ),
        ),
      ),
    );
  }
  const security = card(
    'seguranca',
    'Segurança',
    'Trocar a senha encerra as outras sessões.',
    h('div', { class: 'row' }, field('Senha atual', cur), field('Nova senha', next, 'Mínimo de 8 caracteres.'), field('Repita a nova senha', again)),
    h(
      'div',
      { class: 'actions', style: { marginTop: '14px' } },
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            if (next.value !== again.value) return toast('As senhas novas não conferem.', 'err');
            try {
              await api.post('/api/me/password', { current: cur.value, next: next.value });
              cur.value = next.value = again.value = '';
              toast('Senha alterada.');
              loadSessions();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        'Trocar senha',
      ),
    ),
    h('div', { class: 'divider' }),
    h('h3', { style: { fontSize: '14px', margin: '0 0 6px' } }, 'Sessões ativas'),
    sessions,
  );

  // ---------- Plano ----------
  const { plan, usage } = store.me;
  const plans = store.config?.plans || {};
  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const planCard = card(
    'plano',
    'Plano e uso',
    null,
    h(
      'div',
      { class: 'grid grid-2' },
      h('div', h('div', { class: 'muted small' }, 'Plano atual'), h('div', { style: { fontSize: '22px', fontWeight: 750 } }, plan.name), h('div', { class: 'muted small' }, `${fmt.number(plan.postsPerMonth)} posts/mês · ${plan.workspaces} marca${plan.workspaces > 1 ? 's' : ''} · ${plan.accountsPerWorkspace} contas por marca`)),
      h('div', h('div', { class: 'muted small' }, `Uso em ${usage.month}`), h('div', { style: { fontSize: '22px', fontWeight: 750 } }, `${fmt.number(usage.used)} / ${fmt.number(usage.limit)}`), h('div', { class: `bar ${pct >= 100 ? 'err' : pct >= 85 ? 'warn' : ''}` }, h('span', { style: { width: `${pct}%` } }))),
    ),
    h('div', { class: 'divider' }),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data-table' },
        h('thead', h('tr', h('th', 'Plano'), h('th', 'Posts por mês'), h('th', 'Marcas'), h('th', 'Contas por marca'))),
        h('tbody', Object.entries(plans).map(([id, p]) => h('tr', { style: id === plan.id ? { fontWeight: 700 } : null }, h('td', p.name, id === plan.id ? ' (atual)' : ''), h('td', fmt.number(p.postsPerMonth)), h('td', String(p.workspaces)), h('td', String(p.accountsPerWorkspace))))),
      ),
    ),
    h('p', { class: 'muted small', style: { marginBottom: 0 } }, 'Para mudar de plano, fale com quem administra o FlyPost na sua empresa.'),
  );

  // ---------- Chaves de API ----------
  const keys = h('div', loading());
  async function loadKeys() {
    const list = await api.get('/api/keys');
    clear(
      keys,
      list.length
        ? h(
            'div',
            { class: 'list' },
            list.map((k) =>
              h(
                'div',
                { class: 'list-item' },
                icon('key', 18),
                h('div', { class: 'grow' }, h('div', { class: 'title' }, k.name), h('div', { class: 'meta mono' }, `${k.prefix}…  ·  criada ${fmt.date(k.created_at)}  ·  ${k.last_used_at ? `último uso ${fmt.relative(k.last_used_at)}` : 'nunca usada'}`)),
                h(
                  'button',
                  {
                    class: 'btn ghost sm',
                    onclick: async () => {
                      if (!(await confirmDialog({ title: `Revogar "${k.name}"?`, message: 'Integrações usando esta chave param de funcionar na hora.', confirmText: 'Revogar', danger: true }))) return;
                      await api.del(`/api/keys/${k.id}`);
                      toast('Chave revogada.');
                      loadKeys();
                    },
                  },
                  'Revogar',
                ),
              ),
            ),
          )
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhuma chave criada.'),
    );
  }
  const keyName = h('input', { class: 'input', placeholder: 'Ex.: n8n, Zapier, planilha' });
  const keysCard = card(
    'chaves',
    'Chaves de API',
    h('span', 'Para agendar posts a partir de outros sistemas. ', h('a', { href: '#/api' }, 'Ver documentação')),
    keys,
    h(
      'div',
      { class: 'row', style: { marginTop: '14px' } },
      field('Nome da nova chave', keyName),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            try {
              const k = await api.post('/api/keys', { name: keyName.value });
              keyName.value = '';
              const m = openModal({
                title: 'Chave criada',
                body: h('div', h('p', { style: { marginTop: 0 } }, 'Copie agora: por segurança, ela não aparece de novo.'), codeBlock(k.secret)),
                foot: [h('button', { class: 'btn primary', onclick: () => m.close() }, 'Já copiei')],
              });
              loadKeys();
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        icon('plus', 16),
        'Criar chave',
      ),
    ),
  );

  // ---------- Webhooks ----------
  const hooks = h('div', loading());
  async function loadHooks() {
    const list = await api.get('/api/webhooks');
    clear(
      hooks,
      list.length
        ? h(
            'div',
            { class: 'list' },
            list.map((w) =>
              h(
                'div',
                { class: 'list-item', style: { flexWrap: 'wrap' } },
                icon('bolt', 18),
                h(
                  'div',
                  { class: 'grow' },
                  h('div', { class: 'title mono' }, w.url),
                  h('div', { class: 'meta' }, w.events.map((e) => EVENTS.find(([k]) => k === e)?.[1] || e).join(', ')),
                  w.last_delivery_at ? h('div', { class: 'meta' }, `Última entrega ${fmt.relative(w.last_delivery_at)}: `, w.last_error ? h('span', { style: { color: 'var(--err)' } }, w.last_error) : h('span', { style: { color: 'var(--ok)' } }, `HTTP ${w.last_status}`)) : null,
                ),
                h(
                  'div',
                  { class: 'actions' },
                  h('label', { class: 'check small' }, h('input', { type: 'checkbox', checked: w.active, onchange: async (e) => (await api.patch(`/api/webhooks/${w.id}`, { active: e.target.checked }), toast(e.target.checked ? 'Webhook ativado.' : 'Webhook pausado.')) }), 'Ativo'),
                  h('button', { class: 'btn ghost sm', onclick: () => copyText(w.secret) }, icon('copy', 14), 'Segredo'),
                  h(
                    'button',
                    {
                      class: 'btn ghost sm',
                      onclick: async (e) => {
                        const btn = e.currentTarget;
                        btn.disabled = true;
                        const r = await api.post(`/api/webhooks/${w.id}/test`).catch((err) => ({ error: err.message }));
                        btn.disabled = false;
                        r.error ? toast(`Falhou: ${r.error}`, 'err') : toast(`Entregue (HTTP ${r.status}).`);
                        loadHooks();
                      },
                    },
                    'Testar',
                  ),
                  h(
                    'button',
                    {
                      class: 'btn ghost icon sm',
                      'aria-label': 'Excluir webhook',
                      onclick: async () => {
                        if (!(await confirmDialog({ title: 'Excluir webhook?', message: w.url, confirmText: 'Excluir', danger: true }))) return;
                        await api.del(`/api/webhooks/${w.id}`);
                        loadHooks();
                      },
                    },
                    icon('trash', 15),
                  ),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted', style: { margin: 0 } }, 'Nenhum webhook. Use para avisar seu CRM, Slack ou automação a cada publicação.'),
    );
  }
  const hookUrl = h('input', { class: 'input', type: 'url', placeholder: 'https://sua-automacao.com/webhook' });
  const chosen = new Set(EVENTS.map(([k]) => k));
  const hooksCard = card(
    'webhooks',
    'Webhooks',
    'O FlyPost envia um POST em JSON, assinado com HMAC-SHA256 no cabeçalho X-FlyPost-Signature.',
    hooks,
    h('div', { class: 'divider' }),
    h('div', { class: 'row' }, field('URL', hookUrl)),
    h('div', { class: 'chips', style: { margin: '12px 0' } }, EVENTS.map(([k, l]) => h('label', { class: 'check', style: { marginRight: '12px' } }, h('input', { type: 'checkbox', checked: true, onchange: (e) => (e.target.checked ? chosen.add(k) : chosen.delete(k)) }), l))),
    h(
      'button',
      {
        class: 'btn primary',
        onclick: async () => {
          try {
            await api.post('/api/webhooks', { url: hookUrl.value, events: [...chosen] });
            hookUrl.value = '';
            toast('Webhook adicionado.');
            loadHooks();
          } catch (err) {
            toast(err.message, 'err');
          }
        },
      },
      icon('plus', 16),
      'Adicionar webhook',
    ),
  );

  // ---------- Aparência ----------
  const themeBox = h('div', { class: 'segmented' });
  const paintTheme = () =>
    clear(
      themeBox,
      [
        ['auto', 'Automático', 'sliders'],
        ['dark', 'Escuro', 'moon'],
        ['light', 'Claro', 'sun'],
      ].map(([v, l, ic]) => h('button', { class: readTheme() === v ? 'on' : '', onclick: () => (saveTheme(v), paintTheme()) }, icon(ic, 15), l)),
    );
  paintTheme();
  const look = card('aparencia', 'Aparência', 'Automático segue o tema do seu sistema.', themeBox);

  // ---------- Excluir conta ----------
  const pass = h('input', { class: 'input', type: 'password', autocomplete: 'current-password' });
  const danger = card(
    'perigo',
    'Excluir conta',
    'Apaga para sempre seus dados, contas conectadas, posts agendados, mídias e histórico.',
    h('div', { class: 'row' }, field('Confirme com sua senha', pass)),
    h(
      'div',
      { class: 'actions', style: { marginTop: '14px' } },
      h(
        'button',
        {
          class: 'btn danger',
          onclick: async () => {
            if (!(await confirmDialog({ title: 'Excluir sua conta?', message: 'Não tem volta. Os posts já publicados continuam nas redes sociais.', confirmText: 'Excluir para sempre', danger: true, typeToConfirm: 'EXCLUIR' }))) return;
            try {
              await api.del('/api/me', { password: pass.value });
              location.href = '/';
            } catch (err) {
              toast(err.message, 'err');
            }
          },
        },
        'Excluir minha conta',
      ),
    ),
  );

  clear(content, profile, security, planCard, keysCard, hooksCard, look, danger);
  await Promise.all([loadSessions(), loadKeys(), loadHooks()]).catch((err) => toast(err.message, 'err'));
}
