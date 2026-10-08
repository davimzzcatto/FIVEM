import { h, codeBlock } from '../ui.js';

export function render(root) {
  const base = location.origin;
  const ep = (method, path, desc) => h('div', h('div', { class: 'endpoint' }, h('span', { class: `method m-${method.toLowerCase()}` }, method), h('span', path)), desc ? h('p', desc) : null);

  root.append(
    h('div', { class: 'page-head' }, h('div', h('h1', 'API do FlyPost'), h('p', 'Agende posts a partir do seu CRM, n8n, Make, Zapier ou de um script.'))),
    h(
      'div',
      { class: 'card doc' },
      h('h2', 'Autenticação'),
      h('p', 'Crie uma chave em ', h('a', { href: '#/configuracoes' }, 'Configurações → Chaves de API'), ' e envie em todas as chamadas no cabeçalho ', h('code', 'Authorization: Bearer fp_live_...'), '. Respostas são JSON; erros trazem ', h('code', '{ "error": "mensagem" }'), '.'),
      codeBlock(`curl ${base}/api/accounts \\\n  -H "Authorization: Bearer $FLYPOST_KEY"`),

      h('h2', 'Contas'),
      ep('GET', '/api/accounts', 'Lista as contas conectadas. Use o campo id em account_ids ao criar posts.'),
      ep('GET', '/api/workspaces', 'Marcas com suas contas.'),

      h('h2', 'Mídia'),
      p('Envie a mídia antes de criar o post. Formatos: JPG, PNG, MP4 e MOV. O Instagram só publica imagem em JPEG; PNG enviado pela API é aceito pelo Facebook mas falha no Instagram.'),
      ep('PUT', '/api/media?name=arquivo.mp4', 'Upload direto: o arquivo vai cru no corpo da requisição, com o Content-Type certo.'),
      codeBlock(`curl -X PUT "${base}/api/media?name=video.mp4" \\\n  -H "Authorization: Bearer $FLYPOST_KEY" \\\n  -H "Content-Type: video/mp4" \\\n  --data-binary @video.mp4`),
      ep('POST', '/api/media/from-url', 'O FlyPost baixa a mídia de uma URL pública.'),
      codeBlock(`curl -X POST ${base}/api/media/from-url \\\n  -H "Authorization: Bearer $FLYPOST_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"url": "https://exemplo.com/foto.jpg"}'`),
      p('Resposta: ', h('code', '{ "id": 42, "kind": "video", "width": 1080, "height": 1920, "duration_ms": 15000, ... }')),

      h('h2', 'Posts'),
      ep('POST', '/api/posts', 'Cria um post (ou o mesmo post em várias contas).'),
      codeBlock(
        `curl -X POST ${base}/api/posts \\\n  -H "Authorization: Bearer $FLYPOST_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(
          { account_ids: [1, 2], type: 'reels', media_ids: [42], caption: '{Novidade|Chegou} na loja!', first_comment: '#moda #promo', scheduled_at: '2026-11-03T18:30:00-03:00', spintax: true },
          null,
          2,
        )}'`,
      ),
      h(
        'ul',
        { class: 'muted', style: { lineHeight: 1.8 } },
        li('type', 'reels, image, carousel ou story. TikTok aceita só reels (vídeo); Facebook não tem story.'),
        li('scheduled_at', 'data ISO 8601 com fuso, ou milissegundos desde 1970. Omitido com publish_now: true, publica na hora.'),
        li('media_ids', 'carousel aceita de 2 a 10 mídias; os demais tipos, 1.'),
        li('spintax', 'true sorteia {opção|outra} na legenda de cada conta.'),
        li('options', 'share_to_feed (Reels no feed), thumb_offset_ms (capa do vídeo), cover_media_id (imagem de capa), tiktok_privacy, disable_comment.'),
        li('dry_run', 'true só valida e devolve erros e avisos, sem criar nada.'),
      ),
      ep('POST', '/api/posts/batch', 'Vários posts de uma vez: items é uma lista com media_ids, caption, first_comment e scheduled_at por item. Até 500 itens.'),
      codeBlock(`{\n  "account_ids": [1],\n  "type": "image",\n  "items": [\n    { "media_ids": [10], "caption": "Post 1", "scheduled_at": 1793800000000 },\n    { "media_ids": [11], "caption": "Post 2", "scheduled_at": 1793886400000 }\n  ]\n}`),
      ep('GET', '/api/posts?status=scheduled&from=…&to=…', 'Lista posts. Filtros: status (scheduled, publishing, published, failed, canceled; vários separados por vírgula), from/to em milissegundos, workspace_id, account_id, batch_id, limit, order=desc.'),
      ep('GET', '/api/posts/:id'),
      ep('PATCH', '/api/posts/:id', 'Altera caption, first_comment, scheduled_at ou options de um post que ainda não saiu.'),
      ep('POST', '/api/posts/:id/publish-now'),
      ep('POST', '/api/posts/:id/retry', 'Coloca um post com falha de volta na fila, para agora.'),
      ep('POST', '/api/posts/:id/cancel'),
      ep('DELETE', '/api/posts/:id'),
      ep('POST', '/api/batches/:batch_id/cancel', 'Cancela tudo o que ainda está na fila de um lote.'),

      h('h2', 'Limites'),
      p('Cada plano tem um teto de posts por mês (contam os agendados, em publicação e publicados). Por conta, o FlyPost recusa mais de 100 posts em 24h no Instagram e no Facebook e mais de 15 no TikTok, e avisa a partir de 10 por dia.'),

      h('h2', 'Webhooks'),
      p('Cadastre em Configurações. Eventos: post.published, post.failed e account.expired. Cada entrega é um POST com este formato:'),
      codeBlock(`{\n  "event": "post.published",\n  "created_at": "2026-11-03T21:30:04.120Z",\n  "data": {\n    "post_id": 123,\n    "account_id": 1,\n    "platform": "instagram",\n    "username": "minhaloja",\n    "type": "reels",\n    "remote_id": "17890000000000000",\n    "permalink": "https://www.instagram.com/reel/...",\n    "published_at": 1793741404120\n  }\n}`),
      p('Confira a assinatura antes de confiar no conteúdo. Exemplo em Node.js:'),
      codeBlock(
        `import crypto from 'node:crypto';\n\nfunction assinaturaValida(corpoBruto, cabecalho, segredo) {\n  const esperado = 'sha256=' + crypto.createHmac('sha256', segredo).update(corpoBruto).digest('hex');\n  return cabecalho.length === esperado.length &&\n    crypto.timingSafeEqual(Buffer.from(cabecalho), Buffer.from(esperado));\n}\n\n// cabecalho = req.headers['x-flypost-signature']`,
      ),
    ),
  );

  function p(...children) {
    return h('p', ...children);
  }
  function li(name, text) {
    return h('li', h('code', name), ' — ', text);
  }
}
