// Regras de cada rede: tipos aceitos, limites de mídia e de texto.
// Compartilhado entre navegador (aviso antes de agendar) e servidor (validação final).

export const PLATFORMS = {
  instagram: { label: 'Instagram', types: ['reels', 'image', 'carousel', 'story'], captionMax: 2200, perDay: 100 },
  facebook: { label: 'Facebook', types: ['reels', 'image', 'carousel'], captionMax: 63206, perDay: 100 },
  // O TikTok limita cada criador a algumas dezenas de posts por dia via API; 15 é o teto prudente.
  tiktok: { label: 'TikTok', types: ['reels'], captionMax: 2200, perDay: 15 },
};

export const TYPES = {
  reels: { label: 'Reels / Vídeo', min: 1, max: 1 },
  image: { label: 'Imagem', min: 1, max: 1 },
  carousel: { label: 'Carrossel', min: 2, max: 10 },
  story: { label: 'Story', min: 1, max: 1 },
};

export const RECOMMENDED_PER_DAY = 10;
export const IMAGE_RATIO = { min: 4 / 5, max: 1.91 };
export const VIDEO_SECONDS = { min: 3, max: 15 * 60 };
const DAY_MS = 24 * 60 * 60 * 1000;

const count = (text, re) => (String(text || '').match(re) || []).length;
export const hashtagCount = (text) => count(text, /(^|\s)#[\p{L}\p{N}_]+/gu);
export const mentionCount = (text) => count(text, /(^|\s)@[\w.]+/g);

export function supports(platform, type) {
  return Boolean(PLATFORMS[platform]?.types.includes(type));
}

// media: [{ kind: 'image'|'video', width, height, duration_ms }]
export function validatePost({ platform, type, media = [], caption = '', firstComment = '' }) {
  const errors = [];
  const p = PLATFORMS[platform];
  const t = TYPES[type];
  if (!p) return ['Rede social desconhecida.'];
  if (!t) return ['Tipo de publicação desconhecido.'];
  if (!supports(platform, type)) return [`${p.label} não aceita ${t.label.toLowerCase()} por aqui.`];

  if (media.length < t.min) errors.push(t.min > 1 ? `${t.label} precisa de pelo menos ${t.min} arquivos.` : 'Falta a mídia do post.');
  if (media.length > t.max) errors.push(`${t.label} aceita no máximo ${t.max} arquivo${t.max > 1 ? 's' : ''}.`);

  const videos = media.filter((m) => m.kind === 'video');
  const images = media.filter((m) => m.kind === 'image');
  if (type === 'reels' && images.length) errors.push('Reels e vídeos precisam de um arquivo de vídeo.');
  if (type === 'image' && videos.length) errors.push('Para vídeo, use o tipo Reels / Vídeo.');
  if (type === 'carousel' && platform === 'facebook' && videos.length) errors.push('No Facebook o carrossel aceita só imagens.');

  if (platform === 'instagram' && (type === 'image' || type === 'carousel')) {
    for (const m of images) {
      if (!m.width || !m.height) continue;
      const ratio = m.width / m.height;
      if (ratio < IMAGE_RATIO.min - 0.005 || ratio > IMAGE_RATIO.max + 0.005) {
        errors.push(`Imagem ${m.width}×${m.height} fora da proporção do feed do Instagram (de 4:5 a 1,91:1).`);
        break;
      }
    }
  }
  for (const m of videos) {
    if (m.duration_ms == null) continue;
    const s = m.duration_ms / 1000;
    if (s < VIDEO_SECONDS.min) errors.push(`Vídeo curto demais (${s.toFixed(1)}s). O mínimo é ${VIDEO_SECONDS.min}s.`);
    else if (s > VIDEO_SECONDS.max) errors.push(`Vídeo longo demais (${Math.round(s / 60)} min). O máximo é 15 min.`);
  }

  if (caption.length > p.captionMax) errors.push(`Legenda com ${caption.length} caracteres; o limite do ${p.label} é ${p.captionMax}.`);
  if (platform === 'instagram') {
    if (hashtagCount(caption) > 30) errors.push('O Instagram aceita até 30 hashtags na legenda.');
    if (mentionCount(caption) > 20) errors.push('O Instagram aceita até 20 menções na legenda.');
    if (firstComment && hashtagCount(firstComment) > 30) errors.push('O Instagram aceita até 30 hashtags no comentário.');
    if (firstComment.length > 2200) errors.push('O primeiro comentário passa de 2.200 caracteres.');
  }
  return errors;
}

// Maior quantidade de horários dentro de qualquer janela móvel de 24h.
export function maxInWindow(times, windowMs = DAY_MS) {
  const sorted = [...times].sort((a, b) => a - b);
  let best = 0;
  let lo = 0;
  for (let hi = 0; hi < sorted.length; hi++) {
    while (sorted[hi] - sorted[lo] >= windowMs) lo++;
    best = Math.max(best, hi - lo + 1);
  }
  return best;
}
