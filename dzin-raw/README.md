# dzin.raw — primeira dobra

Clone da primeira dobra do [jorgewebpro.com](https://www.jorgewebpro.com/) com o conteúdo
do dzin.raw. Uma tela só: foto ocupando o fundo inteiro, coluna de texto à esquerda,
assinatura embaixo à direita e nav fino no topo — a mesma composição da referência.

```
index.html          a página inteira (HTML + CSS + JS, sem build)
img/retrato.webp    a foto do hero (1671×941)
```

A única requisição externa é a fonte no Google Fonts.

---

## O que está na página

| Elemento | Conteúdo |
|---|---|
| Headline | **Seu _negócio_ / _evento_ / _casamento_ / _business_ merece um criativo à altura.** — a palavra troca sozinha a cada 2,6 s |
| Apoio | Design, motion, edição. Mais do que falar sobre o que posso fazer, é mostrar na prática. |
| CTA principal | *Vamos tirar sua ideia do papel ↗* → WhatsApp (18) 99769-5327 com mensagem pronta |
| CTA secundário | *@dzin.raw* → Instagram |
| Nav | marca à esquerda, ícone do Instagram à direita |
| Assinatura | `dzin.raw` grande embaixo à direita (some no celular, como na referência) |

---

## Mexer no conteúdo

**As palavras que giram** ficam no `<script>` no fim do `index.html`:

```js
var VARIACOES = [
  { art: "Seu", palavra: "negócio"   },
  { art: "Seu", palavra: "evento"    },
  { art: "Seu", palavra: "casamento" },
  { art: "Seu", palavra: "business"  }
];
var INTERVALO = 2600;   // ms que cada palavra fica na tela
```

O artigo vai junto com a palavra de propósito: para entrar palavra feminina é só
`{ art: "Sua", palavra: "marca" }` que a concordância continua certa. Dá para pôr
quantas quiser; com uma só, o giro desliga sozinho.

**WhatsApp e Instagram**: os dois links aparecem no bloco `.cta-row` (e o Instagram
também na nav). O número está no formato `wa.me/5518997695327` — 55 do Brasil, 18 do
DDD. A mensagem pronta vai no `?text=`.

**A foto**: trocar `img/retrato.webp` mantendo o nome. No desktop ela é cortada em
`background-position: 55% 48%` para o rosto ficar à direita do texto; no celular o
corte é central. Se a foto nova tiver o rosto em outro lugar, é esse valor que ajusta.

**Quem tem motivo para mudar junto**: o escurecimento (`.hero::before`) existe para o
texto branco ler em cima da foto. Foto mais clara pede gradiente mais forte.

---

## Identidade

Medidas vindas do CSS da referência, tokens no `:root` do `index.html`.

| Token | Valor | Uso |
|---|---|---|
| `--night` | `#04070F` | fundo atrás da foto |
| `--ink` / `--ink-soft` | `#FFFBF8` / `rgba(255,247,241,.84)` | texto e texto de apoio |
| `--blue` | `#2F9BE8` | bolinha da seta e preenchimento do botão no hover |
| `--blue-lit` | `#BFE4FF` | a palavra que gira |

O azul saiu do contraluz da própria foto, então o botão e o headline conversam com a
imagem em vez de brigar com ela.

**Tipografia**: a referência usa *Product Sans Infanity*, que não está no Google Fonts.
Substituída por **Poppins**, a geométrica mais próxima — headline em weight 300,
assinatura em 200. Para fidelidade total, licenciar a original e trocar `--f`.

**Herdado da referência**: altura de tela cheia com cantos arredondados embaixo
(22 px), headline em peso leve e entrelinha fechada, pílula branca com bolinha azul
e o layout invertendo para texto centralizado embaixo no celular.

---

## Publicar em domínio próprio

O `index.html` foi escrito no formato de Artifact — começa em `<title>`, sem
`<!DOCTYPE>`/`<html>`/`<head>`/`<body>`. Para subir em domínio, prefixe:

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="dzin.raw — design, motion e edição. Seu negócio merece um criativo à altura.">
<style>*{box-sizing:border-box}body{margin:0}img{max-width:100%}</style>
</head>
<body>
```

e feche com `</body></html>`, com a pasta `img/` ao lado. Antes de subir campanha:
og:image, favicon e os pixels de Meta/Google Ads.

---

## Pendências

- Confirmar se o número do WhatsApp é o oficial de atendimento (hoje: 18 99769-5327)
- Texto da mensagem pronta do WhatsApp
- As seções seguintes do site (esta entrega é só a primeira dobra)
