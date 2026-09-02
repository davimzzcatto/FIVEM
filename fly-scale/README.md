# Fly Scale — Página de vendas

PV do Fly Scale (implementação do Grupo Fly), modelada 1:1 no sistema visual da PV de
evento da Sand Academy e adaptada para vender **duas modalidades**: presencial na sede,
em Araçatuba/SP, e online ao vivo.

**Próxima turma: 26 e 27 de Setembro.** O contador regressivo está ligado.

```
index.html            fonte — referencia media/ e img/ por caminho relativo. É este que vai pro domínio.
build.py              gera dist/index.html com as mídias embutidas como data URI
dist/index.html       versão publicada como Artifact (o claude.ai não resolve caminho relativo)
media/                vídeo de convite e poster
img/                  fotos das turmas, retrato e depoimentos
```

Sem dependência de build além do `build.py` (Python puro, sem pacote externo).
A única requisição externa da página é a fonte no Google Fonts.

---

## Mapa de seções

| # | Função na PV de referência | Fly Scale |
|---|---|---|
| 1 | Faixa vermelha de topo com o público | “Exclusivo para donos de agência de viagens” |
| 2 | Hero: marca, data, headline com destaque, CTA, escassez, contador | Idem + **vídeo de convite** à direita |
| 3 | Pergunta de transição + comparação Sem/Com | **Agência passiva** (card branco) vs. **agência ativa** (card vermelho→laranja), escalonados |
| 4 | Prova social | **Galeria das turmas anteriores** (aparece quando as fotos estiverem em `img/`) |
| 5 | O que você vai implementar em dois dias | 6 cards de entregável |
| 6 | — | **Sozinho x Fly Scale**: barra longa “meses de tentativa e erro” contra barra curta “dois dias” |
| 7 | Ancoragem de valor | “Quanto vale transformar sua agência em uma operação previsível?” |
| 8 | Oferta + preço + CTA no container escuro | **Dois cards de modalidade**: presencial (gradiente quente) e online (escuro) |
| 9 | Cronograma | Horários + **grade completa dos 2 dias** (11 módulos) |
| 10 | “Por que tão barato?” | **“Por que só 30 cadeiras — e por que agora tem online?”** — mesma função (quebra a objeção central), invertida porque aqui o preço é premium |
| 11 | Garantia 7 dias | Garantia de 7 dias |
| 12 | FAQ + falar com suporte | 9 perguntas cobrindo as duas modalidades |
| 13 | Quem é o especialista | Luiz Gregatti (+ bloco de depoimentos pronto, desligado) |
| 14 | Verificador de número oficial | Canais oficiais / antifraude |
| 15 | Rodapé | Rodapé Grupo Fly |

CTAs: hero, barra fixa (sempre visível), os dois cards de modalidade, a faixa de objeção
e o suporte.

---

## Identidade

Valores medidos direto do CSS da PV de referência. Tokens todos no `:root` do `index.html`.

| Token | Valor | Uso |
|---|---|---|
| `--black` | `#000000` | fundo da página, preto puro |
| `--red` | `#FF2B1F` | caixa de destaque inline no título, bullets `›`, faixa de topo |
| `--red-2` | `#E8290F` | topo da faixa vermelho→preto |
| `--orange` / `--red-deep` | `#FE4717` / `#8B0C09` | gradiente do card “agência ativa” e da barra “sozinho” |
| `--green-1` / `--green-2` | `#15EA5F` / `#45FDA4` | gradiente do botão CTA |
| `--panel` / `--line` | `#141414` / `#2D2D2D` | container escuro e bordas finas |
| `--grey` / `--grey-2` | `#929292` / `#6C6C6C` | texto de apoio |
| `--ink` | `#333333` | texto sobre superfície branca |

Padrões vindos da referência:

- **Headings em weight 400**, grandes. O peso vem do `<b>` inline e da caixa vermelha
  `.mk`, não do heading — é a assinatura tipográfica da página.
- **CTA**: `linear-gradient(116deg, #15EA5F, #45FDA4)`, texto preto, radius 10px,
  padding 20px 23px.
- **Comparação**: card branco (radius 20px, padding 33/30/30) contra card em gradiente
  vermelho→laranja, escalonados no desktop.
- **Container da oferta**: `linear-gradient(#141414, #000)`, radius 26px,
  borda `2px solid #2D2D2D`.
- **Quebra de objeção**: faixa full-bleed em gradiente vermelho→preto.
- **Bullets**: chevron `›` vermelho.

**Tipografia**: a referência usa Switzer, que não está no Google Fonts. Substituída por
**Figtree**, a grotesca geométrica mais próxima. Para fidelidade total, licenciar Switzer
e trocar `--f` mais o `@font-face`.

O símbolo Fly Scale está reconstruído em SVG inline (`<symbol id="fs-mark">`) a partir de
uma imagem de referência. **Substituir pelo arquivo oficial de marca antes de publicar.**

---

## Mídia

### Vídeo de convite

O original (1080p, 50s, 29,8 MB) foi recomprimido:

| Arquivo | Uso | Especificação |
|---|---|---|
| `media/convite.mp4` | produção | 1280×720, CRF 27, AAC 96k, `+faststart` — 5,5 MB |
| `media/convite-embed.mp4` | embutido no Artifact | 960×540, CRF 31, AAC 64k mono — 2,7 MB |
| `media/convite-poster.jpg` | poster do player | 1280 de largura — 76 KB |

O `+faststart` põe o índice no começo do arquivo, então o vídeo começa a tocar antes de
baixar inteiro. Para produção, considere servir por CDN ou plataforma de vídeo em vez do
MP4 direto.

### Imagens que faltam

Salvar em `img/` com estes nomes exatos — a página referencia eles diretamente:

| Arquivo | Uso | Recorte |
|---|---|---|
| `turma-01.jpg` … `turma-08.jpg` | galeria das turmas | 4:3 |
| `luiz.jpg` | retrato do Luiz Gregatti | 4:5 vertical |
| `depo-01.jpg` … `depo-03.jpg` | fotos dos depoimentos | quadrado |

**A galeria e o retrato se escondem sozinhos** enquanto os arquivos não existirem (o
script no fim do `index.html` verifica se as imagens carregaram). Nada de buraco no
layout, e eles aparecem automaticamente quando os arquivos entrarem — não precisa mexer
no código.

Confirmar autorização de uso de imagem dos participantes antes de publicar.

### Depoimentos

O bloco está pronto e **comentado** no `index.html`, logo antes da seção de suporte.
Para ligar: descomentar e trocar os três cards por depoimentos reais (nome, cidade e
foto autorizados).

---

## Gerar a versão publicada

```
python3 build.py
```

Lê o `index.html`, troca cada `src`/`poster` de `media/` e `img/` que exista em disco por
um data URI, e escreve `dist/index.html`. Avisa se passar de 15 MB (o limite do Artifact
é 16 MB). Arquivo que não existe é ignorado, e a página esconde o bloco sozinha.

Hoje: `dist/index.html` sai com 3,61 MB (vídeo + poster embutidos).

---

## Mudar a data da turma

No fim do `index.html`:

```js
var TURMA_INICIO = "2026-09-26T09:30:00-03:00";  // ISO, fuso de Brasília
var TURMA_ROTULO = "26 e 27 de Setembro";        // como aparece na página
```

As duas alimentam a pill do hero, a barra fixa e o contador. Em `null`, a página mostra
“a definir” e o contador não liga, em vez de exibir uma data falsa.

---

## Pendências antes de subir campanha

**Liderança**
- **Preço da modalidade online** — o card mostra “a definir” até ser informado
  (o presencial está em R$ 5.000, conforme direcionado)
- Parcelamento e formas de pagamento das duas modalidades
- Links de checkout (hoje os CTAs apontam para a seção de suporte)
- Redação e prazo da garantia + política de remarcação (validar com o jurídico)

**Operação**
- Plataforma da transmissão do online e limite de vagas da turma online
- Se o online tem gravação e por quanto tempo
- Link do WhatsApp oficial do suporte e lista de canais oficiais

**Conteúdo**
- Fotos das turmas, retrato do Luiz e depoimentos (ver **Mídia** acima)
- Bio oficial do Luiz aprovada pela liderança
- Arquivos oficiais de marca: Fly Scale, Grupo Fly, Viajaflux, AHO, Fly Growth

Nenhum número de faturamento, resultado de aluno ou depoimento foi inventado.

---

## Publicar em domínio próprio

Use o `index.html` (não o `dist/`), com as pastas `media/` e `img/` ao lado. Ele foi
escrito no formato de Artifact — começa em `<title>`, sem `<!DOCTYPE>`/`<html>`/`<head>`/
`<body>`. Prefixe:

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Fly Scale: dois dias de implementação prática para a sua agência de viagens — 26 e 27 de setembro, presencial em Araçatuba/SP ou online, ao vivo.">
<style>*{box-sizing:border-box}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
```

e feche com `</body></html>`. Adicionar og:image, favicon e os pixels de Meta/Google Ads
antes de subir a campanha.
