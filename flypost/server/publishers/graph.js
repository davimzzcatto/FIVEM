import { graphError, networkError } from './errors.js';

// Chamada à Graph API (Instagram/Facebook). GET manda os parâmetros na query; o resto, como formulário.
export async function graph(fetch, method, url, params = {}, { headers = {}, timeoutMs = 60_000 } = {}) {
  const u = new URL(url);
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '');
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(timeoutMs) };
  if (method === 'GET') {
    for (const [k, v] of clean) u.searchParams.set(k, String(v));
  } else {
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    init.body = new URLSearchParams(clean.map(([k, v]) => [k, String(v)])).toString();
  }
  let res;
  try {
    res = await fetch(u, init);
  } catch (err) {
    throw networkError(err);
  }
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* corpo não-JSON: tratado abaixo */
  }
  if (!res.ok || body?.error) throw graphError(res.status, body || { error: { message: text.slice(0, 200) } });
  return body;
}
