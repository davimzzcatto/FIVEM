# FlyPost

Agendamento e publicação automática de posts no **Instagram, Facebook e TikTok**:
Reels/vídeos, imagens, carrosséis e stories. Feito como uma versão própria (código, textos e
identidade visual originais) do conjunto de funcionalidades de ferramentas como o SpeedPost.

- Lotes de até 500 posts: cada arquivo vira um post, ou os arquivos viram carrosséis de N itens
- Distribuição automática de horários: horários fixos por dia ou intervalo dentro de uma janela,
  com escolha de dias da semana e ajuste manual post a post
- Legendas com variações (`{Oi|Olá} pessoal`), primeiro comentário automático (hashtags), Reels no feed ou não
- Várias marcas (workspaces), cada uma com suas contas; um lote pode ir para contas de marcas diferentes
- Calendário mensal e em lista, com arrastar para reagendar
- Fila com novas tentativas automáticas, histórico de tudo e aba de falhas com "tentar de novo"
- Painel, análises (publicações por dia, por rede, por tipo, mapa de horários)
- Limites por plano (posts/mês, marcas, contas) e teto seguro por conta em 24h
- API REST com chaves, webhooks assinados (HMAC-SHA256) e documentação dentro do app
- **Contas de teste**: o fluxo inteiro funciona sem nenhuma credencial de rede social

Sem dependências: só **Node.js 22.5+** (usa `node:sqlite`, embutido no Node). `ffprobe` é
opcional; quando existe, mede duração e dimensões dos vídeos no servidor.

---

## Rodar local

```bash
cd flypost
cp .env.example .env      # opcional: tudo tem padrão
npm start                 # http://localhost:3000
```

1. Crie uma conta na tela inicial.
2. Em **Contas**, clique em **Conta de teste** e crie um Instagram simulado.
3. Em **Agendar**, envie vídeos ou imagens, escreva a legenda, escolha os horários e agende.

Nas contas de teste, escreva `[falhar]` na legenda para simular uma falha definitiva, ou
`[instavel]` para simular uma falha temporária (o post falha na primeira tentativa e sai na seguinte).

```bash
npm test                  # 37 testes: API, agendador, publicadores (com respostas simuladas) e bibliotecas
npm run plan              # lista usuários e planos
npm run plan -- ana@empresa.com pro   # troca o plano de alguém
```

---

## Estrutura

```
server/
  index.js            sobe o HTTP e o agendador
  app.js              monta tudo (os testes injetam fetch/relógio falsos aqui)
  db.js               SQLite + migrações
  auth.js crypto.js   sessão por cookie, chaves de API, scrypt, AES-GCM para os tokens das redes
  posts.js            validação e criação de lotes, limites do plano e de 24h
  scheduler.js        fila: publica o que venceu, novas tentativas (1, 5 e 15 min), recuperação
  oauth.js accounts.js  login nas redes e renovação de tokens
  media.js            upload em stream, leitura de dimensões, importação por URL (com bloqueio de SSRF)
  events.js           histórico + webhooks
  publishers/         instagram, facebook, tiktok, simulator
  routes/             rotas da API
public/
  index.html css/ js/ app de página única, sem etapa de build
  lib/                regras das redes, spintax e gerador de horários (usados no navegador e no servidor)
scripts/plan.js       troca de plano pela linha de comando
test/                 node:test
```

Dados ficam em `DATA_DIR` (padrão `./data`): `flypost.db`, `uploads/` e `secret.key`.

---

## Conectar as redes de verdade

As três plataformas **baixam a mídia do seu servidor**, então `PUBLIC_URL` precisa ser um
endereço **HTTPS acessível pela internet** (domínio próprio ou, para testar, um túnel como
Cloudflare Tunnel ou ngrok). Em cada app, cadastre a Redirect URI indicada.

### Instagram (login direto pelo Instagram)

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo *Business*
   e adicione o produto **Instagram → API setup with Instagram login**.
2. Copie o *Instagram app ID* e o *Instagram app secret* para `INSTAGRAM_APP_ID` e `INSTAGRAM_APP_SECRET`.
3. Em *Business login settings*, cadastre a Redirect URI `{PUBLIC_URL}/oauth/instagram/callback`.
4. Permissões usadas: `instagram_business_basic`, `instagram_business_content_publish`,
   `instagram_business_manage_comments` (para o primeiro comentário).
5. Enquanto o app está em desenvolvimento, só contas com papel no app (testers) conseguem conectar.
   Para clientes, envie as permissões para **App Review** (acesso avançado).

A conta precisa ser **profissional** (comercial ou criador de conteúdo). O token dura 60 dias e o
FlyPost renova sozinho quando faltam 15.

### Facebook (Páginas)

1. No mesmo app (ou outro), adicione **Facebook Login for Business**.
2. Preencha `META_APP_ID` e `META_APP_SECRET`; Redirect URI: `{PUBLIC_URL}/oauth/facebook/callback`.
3. Permissões: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `business_management`.
4. Depois do login, a pessoa escolhe quais Páginas conectar. O token de Página não expira.

Vídeos verticais de até 90s saem como Reels da Página; os demais, como vídeo comum.

### TikTok

1. Em [developers.tiktok.com](https://developers.tiktok.com), crie um app com **Login Kit** e
   **Content Posting API** (com *Direct Post* ligado).
2. Preencha `TIKTOK_CLIENT_KEY` e `TIKTOK_CLIENT_SECRET`; Redirect URI: `{PUBLIC_URL}/oauth/tiktok/callback`.
3. Escopos: `user.info.basic`, `video.publish`, `video.upload`.
4. **Até o app passar na auditoria do TikTok, os posts só podem sair como privados ("Somente eu")**.
   O FlyPost respeita isso automaticamente e avisa no histórico.

O envio é feito por upload em partes (`FILE_UPLOAD`), então não precisa verificar domínio no TikTok.

---

## Produção

- Node 22.5+ atrás de um proxy HTTPS (Nginx, Caddy, Cloudflare). O app escuta em `PORT`.
- `DATA_DIR` em disco persistente, com **backup do banco, de `uploads/` e do `secret.key`**
  (sem a chave, os tokens salvos não abrem e todas as contas precisam ser reconectadas).
  Prefira definir `APP_SECRET` no ambiente.
- **Rode uma única instância**: o banco é SQLite e o agendador roda no mesmo processo.
  Ao reiniciar, posts que estavam no meio da publicação viram falha com aviso (não são repetidos,
  para não arriscar post duplicado).
- `ALLOW_SIGNUP=false` fecha o cadastro público.
- Mídias de posts publicados são apagadas do disco 30 dias depois; as de posts pendentes ficam.

### Segurança

- Senhas com scrypt; sessões em cookie `HttpOnly`/`SameSite=Lax` (e `Secure` quando `PUBLIC_URL` é HTTPS).
- Chamadas do navegador que alteram dados exigem o cabeçalho `X-FlyPost`, que outro site não consegue enviar (CSRF).
- Tokens das redes cifrados com AES-256-GCM no banco.
- Importação de mídia por URL e entrega de webhooks bloqueiam endereços da rede interna (SSRF).
- As mídias são servidas em `/m/<nome-aleatório>` sem login, porque as redes precisam baixá-las.
  O nome tem 144 bits aleatórios e não aparece em nenhuma listagem pública.

---

## O que ficou de fora

Fora do escopo desta versão, para decidir se vale construir:

- **Cobrança** (checkout, Pix, cartão): hoje o plano é trocado por `npm run plan`.
- **Notificações** por e-mail, push e WhatsApp: o aviso hoje é por webhook (dá para ligar num
  n8n/Make que manda e-mail ou WhatsApp).
- **Legendas com IA**, editor visual de carrossel, extensão de navegador, diagnóstico de página e
  programa de afiliados.
- **Métricas de engajamento** vindas das redes (alcance, curtidas): as análises atuais contam o que
  o FlyPost publicou. Exigiria as permissões de insights e App Review.
- Autenticação em dois fatores.
