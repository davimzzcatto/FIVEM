export class PublishError extends Error {
  // retryable: vale tentar de novo mais tarde (rede, limite de taxa, instabilidade da plataforma)
  // auth: o token não vale mais; a conta precisa ser reconectada
  constructor(message, { retryable = false, auth = false, code = null } = {}) {
    super(message);
    this.retryable = retryable;
    this.auth = auth;
    this.code = code;
  }
}

// Classifica a resposta de erro da Graph API (Instagram e Facebook).
export function graphError(status, body) {
  const e = body?.error || {};
  const code = Number(e.code);
  const sub = Number(e.error_subcode);
  const msg = e.error_user_msg || e.message || `HTTP ${status}`;
  if (code === 190 || code === 102 || sub === 463 || sub === 467) {
    return new PublishError(`Acesso expirado ou revogado: ${msg}`, { auth: true, code });
  }
  if ([4, 17, 32, 613, 80001, 80002].includes(code)) {
    return new PublishError(`Limite de requisições da plataforma: ${msg}`, { retryable: true, code });
  }
  if (code === 1 || code === 2 || e.is_transient || status >= 500) {
    return new PublishError(`Instabilidade da plataforma: ${msg}`, { retryable: true, code });
  }
  if (code === 9 && sub === 2207042) {
    return new PublishError('A conta bateu o limite de 100 publicações em 24h do Instagram.', { code });
  }
  return new PublishError(msg, { code });
}

export function networkError(err) {
  return new PublishError(`Falha de rede: ${err.message}`, { retryable: true });
}
