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
| 1 | Hero: público + data/formato + headline + CTA + escassez + contador | Marca, tags de público, headline, bordão, painel de embarque com as 2 modalidades, CTA e contador |
| 2 | Pergunta de transição | “Como você sai da teoria e coloca a sua agência rodando em um único fim de semana?” |
| 3 | Comparação Sem/Com plano de vendas | **Agência passiva vs. agência ativa** (vem da própria grade do treinamento) |
| 4 | Prova social (logos de clientes) | **Galeria das turmas anteriores** — fotos reais na sede |
| 5 | — | **Matriz dos 6 nichos** (tabela real, com scroll horizontal) |
| 6 | O que você vai implementar em dois dias | 6 cards de entregável |
| 7 | — | **Funil**: 100 leads → 35 → 20 → 10 → 3 |
| 8 | Ancoragem de valor | “Quanto vale parar de adivinhar e passar a ter processo?” |
| 9 | Oferta + preço + CTA | **Dois bilhetes**: presencial (papel) e online (digital) |
| 10 | Cronograma | Horários do dia + **itinerário completo dos 2 dias** (11 módulos) |
| 11 | “Por que tão barato?” | **“Por que só 30 cadeiras — e por que agora tem online?”** (mesma função: quebra a objeção central, invertida porque aqui o preço é premium) |
| 12 | Garantia 7 dias | Garantia (texto em rascunho, precisa de validação) |
| 13 | FAQ + falar com suporte | 11 perguntas, cobrindo as duas modalidades |
| 14 | Quem é o especialista | Luiz Gregatti + equipe |
| 15 | Verificador de número oficial | Canais oficiais / antifraude |
| 16 | Rodapé | Rodapé Grupo Fly |

CTAs: hero, barra fixa (sempre visível), ancoragem, os dois bilhetes, objeção e suporte.

---

## Identidade

Mundo visual único e escuro — commitado, sem tema claro, como uma PV de marca. Os tokens
estão todos no `:root` do `index.html`.

**Cores** — tiradas do logo Fly Scale (taupe + creme sobre fundo escuro):

| Token | Valor | Uso |
|---|---|---|
| `--ink` / `--ink-2` | `#100F0C` / `#0A0908` | chão (near-black de viés quente) |
| `--cream` | `#E8E2D5` | wordmark, títulos, cor de ação (botões) |
| `--taupe` | `#B8B1A3` | símbolo, eyebrows, detalhes |
| `--paper` | `#E8E2D5` | papel do bilhete presencial (é o próprio creme da marca) |
| `--rust` | `#C1614A` | semântico: agência passiva, escassez, slots a preencher |
| `--sage` | `#7D9471` | semântico: agência ativa |

**Tipografia**: Nunito (display — geométrica arredondada, casa com o wordmark),
Instrument Sans (corpo), IBM Plex Mono (códigos, horários, preços — vernáculo de e-ticket).

**Conceito**: o material codifica a modalidade. O bilhete **presencial** é um cartão de
embarque em papel creme, com picotado; o **online** é um cartão digital, escuro, como tela.

O símbolo Fly Scale está reconstruído em SVG inline (`<symbol id="fs-mark">`).
**Substituir pelo arquivo oficial de marca antes de publicar** — foi remontado a partir de
uma imagem de referência, não é o vetor original.

---

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
- Fotos das turmas em `img/turma-01.jpg` … `img/turma-06.jpg`, recorte 4:3
  — **confirmar autorização de uso de imagem dos participantes**
- Foto oficial do Luiz Gregatti (vertical, 4:5)
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
