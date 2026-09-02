# Fly Scale — Página de vendas

PV do Fly Scale (implementação do Grupo Fly), modelada na estrutura da PV de evento da
Sand Academy e adaptada para vender **duas modalidades**: presencial na sede, em Araçatuba/SP,
e online ao vivo.

Arquivo único: `index.html` (HTML + CSS + JS inline, sem dependência de build).
As únicas requisições externas são as fontes do Google Fonts.

---

## Mapa de seções

A PV de referência foi mapeada função por função. A coluna da direita é o que ficou aqui.

| # | Função na PV de referência | Fly Scale |
|---|---|---|
| 1 | Faixa vermelha de topo com o público | “Exclusivo para donos de agência de viagens” |
| 2 | Hero: marca, pill de data, headline com destaque, CTA, escassez, barra de vagas, contador | Igual, com moldura de mídia à direita |
| 3 | Pergunta de transição + comparação Sem/Com | **Agência passiva** (card branco) vs. **agência ativa** (card vermelho→laranja), escalonados |
| 4 | Prova social (logos de clientes) | **Galeria das turmas anteriores** — fotos reais na sede |
| 5 | — | **Matriz dos 6 nichos** (tabela real, com scroll horizontal) |
| 6 | O que você vai implementar em dois dias | 6 cards de entregável |
| 7 | — | **Funil**: 100 leads → 35 → 20 → 10 → 3 |
| 8 | Ancoragem de valor | “Quanto vale transformar sua agência em uma operação previsível?” |
| 9 | Oferta + preço + CTA dentro do container escuro | **Dois cards de modalidade**: presencial (gradiente quente) e online (escuro) |
| 10 | Cronograma | Horários do dia + **itinerário completo dos 2 dias** (11 módulos) |
| 11 | “Por que tão barato?” | **“Por que só 30 cadeiras — e por que agora tem online?”** (mesma função: quebra a objeção central, invertida porque aqui o preço é premium) |
| 12 | Garantia 7 dias | Garantia (texto em rascunho, precisa de validação) |
| 13 | FAQ + falar com suporte | 11 perguntas, cobrindo as duas modalidades |
| 14 | Quem é o especialista | Luiz Gregatti + equipe |
| 15 | Verificador de número oficial | Canais oficiais / antifraude |
| 16 | Rodapé | Rodapé Grupo Fly |

CTAs: hero, barra fixa (sempre visível), os dois cards de modalidade, a faixa de objeção e o suporte.

---

## Identidade

O sistema visual é modelado 1:1 na PV de referência (evento da Sand Academy), com os
valores medidos direto do CSS dela. Tokens todos no `:root` do `index.html`.

| Token | Valor | Uso |
|---|---|---|
| `--black` | `#000000` | fundo da página, preto puro |
| `--red` | `#FF2B1F` | caixa de destaque inline no título, bullets `›`, faixa de topo |
| `--red-2` | `#E8290F` | topo da faixa vermelho→preto |
| `--orange` / `--red-deep` | `#FE4717` / `#8B0C09` | gradiente do card "agência ativa" |
| `--green-1` / `--green-2` | `#15EA5F` / `#45FDA4` | gradiente do botão CTA |
| `--panel` / `--line` | `#141414` / `#2D2D2D` | container escuro e bordas finas |
| `--grey` / `--grey-2` | `#929292` / `#6C6C6C` | texto de apoio |
| `--ink` | `#333333` | texto sobre o card branco |

Padrões copiados da referência:

- **Headings em weight 400**, grandes. O peso vem do `<b>` inline e da caixa vermelha
  `.mk`, não do próprio heading — é a assinatura tipográfica da página.
- **CTA**: `linear-gradient(116deg, #15EA5F, #45FDA4)`, texto preto, radius 10px,
  padding 20px 23px.
- **Comparação**: card branco (radius 20px, padding 33/30/30) contra card em gradiente
  vermelho→laranja, escalonados verticalmente no desktop.
- **Container da oferta**: `linear-gradient(#141414, #000)`, radius 26px,
  borda `2px solid #2D2D2D`.
- **Quebra de objeção**: faixa full-bleed em gradiente vermelho→preto.
- **Bullets**: chevron `›` vermelho.

**Tipografia**: a referência usa Switzer, que não está no Google Fonts. Substituída por
**Figtree**, a grotesca geométrica mais próxima disponível. Se quiserem fidelidade total,
licenciar Switzer e trocar a `--f` mais o `@font-face`.

O símbolo Fly Scale está reconstruído em SVG inline (`<symbol id="fs-mark">`) a partir de
uma imagem de referência. **Substituir pelo arquivo oficial de marca antes de publicar.**

## O que falta preencher

Todo slot pendente está marcado na própria página com uma tarja tracejada
`A PREENCHER` / `A DEFINIR` (classe `.todo`) — some da página conforme for resolvido.
Busque por `class="todo` no `index.html`.

### Depende da liderança
- **Preço da modalidade online** (o presencial está em R$ 5.000, conforme direcionado)
- Parcelamento, política de lotes e formas de pagamento das duas modalidades
- Links de checkout (presencial e online)
- Redação e prazo da garantia + política de remarcação (validar com o jurídico)
- Política de upgrade do online para o presencial

### Depende da operação
- Data da turma (ver abaixo)
- Plataforma da transmissão do online e limite de vagas da turma online
- Se o online tem gravação e por quanto tempo
- O que a cadeira presencial cobre (coffee break, almoço, hotel parceiro)
- Link do WhatsApp oficial do suporte e lista de canais oficiais

### Depende de conteúdo
- Fotos das turmas em `img/turma-01.jpg` … `img/turma-08.jpg`, recorte 4:3
  — **confirmar autorização de uso de imagem dos participantes**
- Foto oficial do Luiz Gregatti em `img/luiz.jpg` (vertical, 4:5)
- Vídeo de convite ou foto de abertura do hero em `img/hero.jpg` (16:10)
- Bio oficial do Luiz aprovada pela liderança
- Depoimentos reais de participantes (nome, cidade, foto autorizados)
- Arquivos oficiais de marca: Fly Scale, Grupo Fly, Viajaflux, AHO, Fly Growth

Nada de número de faturamento, resultado de aluno ou depoimento foi inventado —
os lugares onde isso entraria estão marcados como slot.

---

## Definir a data e ligar o contador

No fim do `index.html`, duas constantes:

```js
var TURMA_INICIO = "2026-11-14T09:30:00-03:00";  // ISO, fuso de Brasília
var TURMA_ROTULO = "14 e 15 de Novembro";        // como aparece na página
```

Com as duas preenchidas, o painel do hero e a barra fixa passam a mostrar a data e o
contador regressivo liga. Em `null` (padrão), a página mostra “a definir” em vez de
uma data falsa.

---

## Publicar em domínio próprio

O `index.html` foi escrito no formato de Artifact (começa em `<title>`, sem
`<!DOCTYPE>`/`<html>`/`<head>`/`<body>`). Para servir em domínio próprio, prefixe:

```html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="Fly Scale: dois dias de implementação prática para a sua agência de viagens — presencial em Araçatuba/SP ou online, ao vivo.">
<style>*{box-sizing:border-box}body{margin:0}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
```

e feche com `</body></html>`. Adicionar também og:image, favicon e os pixels de
Meta/Google Ads antes de subir a campanha.
