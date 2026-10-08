// Cliente da API do FlyPost (mesma origem, sessão por cookie).

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

let onUnauthorized = () => {};
export function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, body) {
  let res;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: { 'X-FlyPost': '1', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) onUnauthorized();
    throw new ApiError(res.status, data.error || `Erro ${res.status}`, data.details);
  }
  return data;
}

export const api = {
  get: (path, query) => request('GET', query ? `${path}?${new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== ''))}` : path),
  post: (path, body = {}) => request('POST', path, body),
  patch: (path, body = {}) => request('PATCH', path, body),
  del: (path, body) => request('DELETE', path, body),

  // Upload cru com progresso (XHR, porque fetch não informa progresso de envio).
  upload(blob, { name, width, height, duration_ms } = {}, onProgress) {
    return new Promise((resolve, reject) => {
      const q = new URLSearchParams({ name: name || 'arquivo' });
      if (width) q.set('width', Math.round(width));
      if (height) q.set('height', Math.round(height));
      if (duration_ms) q.set('duration_ms', Math.round(duration_ms));
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `/api/media?${q}`);
      xhr.setRequestHeader('X-FlyPost', '1');
      xhr.setRequestHeader('Content-Type', blob.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
      xhr.onload = () => {
        let data = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* resposta vazia */
        }
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new ApiError(xhr.status, data.error || `Falha no upload (${xhr.status}).`));
      };
      xhr.onerror = () => reject(new ApiError(0, 'A conexão caiu durante o upload.'));
      xhr.send(blob);
    });
  },
};
