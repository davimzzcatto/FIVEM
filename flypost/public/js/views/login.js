import { api } from '../api.js';
import { store } from '../store.js';
import { h, icon, field } from '../ui.js';

export function render(root, { onDone }) {
  let mode = 'login';
  const allowSignup = store.config?.allowSignup !== false;

  const error = h('div', { class: 'alert err', hidden: true });
  const name = h('input', { class: 'input', name: 'name', autocomplete: 'name', placeholder: 'Como podemos te chamar' });
  const email = h('input', { class: 'input', name: 'email', type: 'email', autocomplete: 'email', required: true, placeholder: 'voce@empresa.com' });
  const password = h('input', { class: 'input', name: 'password', type: 'password', autocomplete: 'current-password', required: true, minlength: 8, placeholder: '••••••••' });
  const submit = h('button', { class: 'btn primary lg', type: 'submit' }, 'Entrar');
  const nameField = field('Nome', name);
  const title = h('h2', 'Entrar no FlyPost');
  const sub = h('p', { class: 'muted', style: { margin: 0 } });
  const switcher = h('p', { class: 'muted small', style: { textAlign: 'center', margin: '18px 0 0' } });

  function paint() {
    const signup = mode === 'signup';
    nameField.hidden = !signup;
    title.textContent = signup ? 'Criar sua conta' : 'Entrar no FlyPost';
    sub.textContent = signup ? 'Leva menos de um minuto. Dá para testar tudo com contas simuladas.' : 'Que bom te ver de novo.';
    submit.textContent = signup ? 'Criar conta' : 'Entrar';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    switcher.replaceChildren();
    if (allowSignup) {
      switcher.append(
        signup ? 'Já tem conta? ' : 'Ainda não tem conta? ',
        h('a', { href: '#', onclick: (e) => (e.preventDefault(), (mode = signup ? 'login' : 'signup'), (error.hidden = true), paint()) }, signup ? 'Entrar' : 'Criar agora'),
      );
    }
  }

  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        error.hidden = true;
        submit.disabled = true;
        try {
          const body = { email: email.value, password: password.value };
          if (mode === 'signup') {
            body.name = name.value;
            body.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          }
          await api.post(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', body);
          await onDone();
        } catch (err) {
          error.replaceChildren(icon('alert'), h('div', { class: 'grow' }, err.message));
          error.hidden = false;
        } finally {
          submit.disabled = false;
        }
      },
    },
    error,
    nameField,
    field('E-mail', email),
    field('Senha', password, mode === 'signup' ? 'Mínimo de 8 caracteres.' : null),
    submit,
  );

  const point = (ic, t, d) => h('div', h('span', { class: 'ic' }, icon(ic, 18)), h('div', h('b', t), d));

  root.append(
    h(
      'div',
      { class: 'auth' },
      h(
        'section',
        { class: 'auth-pitch' },
        h('a', { class: 'brand', href: '#' }, h('span', { class: 'brand-mark' }, icon('plane', 18)), 'FlyPost'),
        h(
          'div',
          h('h1', 'A semana inteira de posts ', h('em', 'agendada em minutos.')),
          h('p', 'Suba os vídeos e imagens de uma vez, deixe o FlyPost distribuir os horários e acompanhe tudo publicando sozinho no Instagram, Facebook e TikTok.'),
        ),
        h(
          'div',
          { class: 'auth-points' },
          point('upload', 'Lotes de até 500 posts', 'Cada arquivo vira um post. Carrossel, Reels, imagem e story.'),
          point('clock', 'Horários distribuídos sozinhos', 'Horários fixos ou intervalo, com limite seguro por conta.'),
          point('shuffle', 'Legendas que não se repetem', 'Variações com {opção|outra} e primeiro comentário automático.'),
          point('bolt', 'API e webhooks', 'Integre com suas automações e receba aviso de cada publicação.'),
        ),
      ),
      h('section', { class: 'auth-form' }, h('div', { class: 'auth-card' }, title, sub, form, switcher)),
    ),
  );
  paint();
  email.focus();
}
