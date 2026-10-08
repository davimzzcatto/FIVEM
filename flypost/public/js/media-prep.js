// Preparo das mídias no navegador, antes do upload.
// - Imagens viram JPEG (o Instagram só aceita JPEG pela API).
// - Imagens fora da faixa 4:5 a 1,91:1 podem ser encaixadas com fundo desfocado.
// - Vídeos: lê duração e dimensões e gera uma miniatura para a prévia.

import { IMAGE_RATIO } from '../lib/rules.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_EDGE = 2160;

export function kindOf(file) {
  if (/^video\//.test(file.type) || /\.(mp4|mov|m4v)$/i.test(file.name)) return 'video';
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)) return 'image';
  return null;
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* cai para <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

const toBlob = (canvas, q = 0.92) => new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Falha ao gerar a imagem.'))), 'image/jpeg', q));

// Fundo desfocado sem ctx.filter (que o Safari não tem): reduz muito e amplia de volta.
function drawBlurredCover(ctx, src, w, h, W, H) {
  const tiny = document.createElement('canvas');
  const scale = 28 / Math.max(w, h);
  tiny.width = Math.max(2, Math.round(w * scale));
  tiny.height = Math.max(2, Math.round(h * scale));
  tiny.getContext('2d').drawImage(src, 0, 0, tiny.width, tiny.height);
  const cover = Math.max(W / w, H / h);
  const cw = w * cover;
  const ch = h * cover;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(tiny, (W - cw) / 2, (H - ch) / 2, cw, ch);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fillRect(0, 0, W, H);
}

export async function prepareImage(file, { fit = true } = {}) {
  const src = await decode(file);
  const w = src.width;
  const h = src.height;
  const ratio = w / h;
  const outOfRange = ratio < IMAGE_RATIO.min || ratio > IMAGE_RATIO.max;
  const needsFit = fit && outOfRange;
  const needsEncode = file.type !== 'image/jpeg' || file.size > MAX_IMAGE_BYTES || Math.max(w, h) > MAX_EDGE * 1.5;

  if (!needsFit && !needsEncode) {
    src.close?.();
    return { blob: file, width: w, height: h, note: outOfRange ? 'Fora da proporção do feed' : null };
  }

  let W = w;
  let H = h;
  if (needsFit) {
    if (ratio < IMAGE_RATIO.min) W = Math.round(h * IMAGE_RATIO.min);
    else H = Math.round(w / IMAGE_RATIO.max);
  }
  const shrink = Math.min(1, MAX_EDGE / Math.max(W, H));
  W = Math.round(W * shrink);
  H = Math.round(H * shrink);

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (needsFit) drawBlurredCover(ctx, src, w, h, W, H);
  const contain = Math.min(W / w, H / h);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, (W - w * contain) / 2, (H - h * contain) / 2, w * contain, h * contain);
  src.close?.();

  const blob = await toBlob(canvas);
  return { blob, width: W, height: H, note: needsFit ? 'Ajustada para caber no feed' : null };
}

export function prepareVideo(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    let settled = false;
    const finish = (out) => {
      if (settled) return;
      settled = true;
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      resolve({ blob: file, ...out });
    };
    // Formatos que o navegador não decodifica (ex.: HEVC no Chrome) seguem sem metadados; o servidor mede com ffprobe.
    v.onerror = () => finish({ width: null, height: null, duration_ms: null, poster: null });
    setTimeout(() => finish({ width: v.videoWidth || null, height: v.videoHeight || null, duration_ms: v.duration ? Math.round(v.duration * 1000) : null, poster: null }), 8000);
    v.onloadedmetadata = () => {
      v.currentTime = Math.min(0.5, (v.duration || 1) / 2);
    };
    v.onseeked = async () => {
      let poster = null;
      try {
        const c = document.createElement('canvas');
        const scale = 360 / Math.max(v.videoWidth, v.videoHeight);
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        poster = URL.createObjectURL(await toBlob(c, 0.8));
      } catch {
        /* sem miniatura */
      }
      finish({ width: v.videoWidth, height: v.videoHeight, duration_ms: Math.round(v.duration * 1000), poster });
    };
    v.src = url;
  });
}
