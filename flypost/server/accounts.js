import { HttpError } from './http.js';
import { planOf } from './plans.js';

// Contas de redes sociais: tokens cifrados no banco, renovação e marcação de expiradas.
export function createAccounts({ db, cipher, oauth, events, now = Date.now, logger = console }) {
  function load(id) {
    const row = db.get('SELECT * FROM accounts WHERE id = ?', id);
    if (!row) return null;
    return {
      ...row,
      accessToken: cipher.decrypt(row.access_token_enc),
      refreshToken: cipher.decrypt(row.refresh_token_enc),
      settings: JSON.parse(row.settings_json || '{}'),
    };
  }

  function serialize(row) {
    return {
      id: row.id,
      workspace_id: row.workspace_id,
      platform: row.platform,
      mode: row.mode,
      username: row.username,
      display_name: row.display_name,
      avatar_url: row.avatar_url,
      status: row.status,
      status_detail: row.status_detail,
      token_expires_at: row.token_expires_at,
      settings: JSON.parse(row.settings_json || '{}'),
      created_at: row.created_at,
    };
  }

  function assertRoom(user, workspaceId) {
    const n = db.get('SELECT COUNT(*) AS n FROM accounts WHERE workspace_id = ?', workspaceId).n;
    const max = planOf(user).accountsPerWorkspace;
    if (n >= max) throw new HttpError(403, `Seu plano permite ${max} contas por marca. Remova uma ou mude de plano.`);
  }

  // Conecta (ou reconecta) uma conta. Reconectar mantém a marca original e reativa a conta.
  function upsert(user, workspaceId, p, mode = 'live') {
    const t = now();
    const existing = db.get('SELECT id FROM accounts WHERE user_id = ? AND platform = ? AND external_id = ?', user.id, p.platform, p.external_id);
    if (existing) {
      db.run(
        `UPDATE accounts SET username = ?, display_name = ?, avatar_url = ?, access_token_enc = ?, refresh_token_enc = ?,
           token_expires_at = ?, refresh_expires_at = ?, token_issued_at = ?, status = 'active', status_detail = NULL, updated_at = ?
         WHERE id = ?`,
        p.username,
        p.display_name,
        p.avatar_url,
        cipher.encrypt(p.access_token),
        cipher.encrypt(p.refresh_token),
        p.token_expires_at,
        p.refresh_expires_at,
        t,
        t,
        existing.id,
      );
      return { id: existing.id, reconnected: true };
    }
    assertRoom(user, workspaceId);
    const r = db.run(
      `INSERT INTO accounts (user_id, workspace_id, platform, mode, external_id, username, display_name, avatar_url,
         access_token_enc, refresh_token_enc, token_expires_at, refresh_expires_at, token_issued_at, status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`,
      user.id,
      workspaceId,
      p.platform,
      mode,
      p.external_id,
      p.username,
      p.display_name,
      p.avatar_url,
      cipher.encrypt(p.access_token),
      cipher.encrypt(p.refresh_token),
      p.token_expires_at,
      p.refresh_expires_at,
      t,
      t,
      t,
    );
    return { id: Number(r.lastInsertRowid), reconnected: false };
  }

  function markExpired(acc, reason) {
    if (acc.status === 'expired') return;
    db.run("UPDATE accounts SET status = 'expired', status_detail = ?, updated_at = ? WHERE id = ?", reason, now(), acc.id);
    events.log(acc.user_id, { level: 'error', event: 'account.expired', accountId: acc.id, message: `@${acc.username} precisa ser reconectada: ${reason}` });
    events.emit(acc.user_id, 'account.expired', { account_id: acc.id, platform: acc.platform, username: acc.username, reason });
  }

  // Renova o token se estiver perto de vencer. Devolve a conta atualizada.
  async function ensureFresh(acc) {
    if (acc.mode !== 'live') return acc;
    const provider = oauth[acc.platform];
    if (!provider?.needsRefresh(acc)) return acc;
    try {
      const fresh = await provider.refresh(acc);
      const t = now();
      db.run(
        `UPDATE accounts SET access_token_enc = ?, refresh_token_enc = COALESCE(?, refresh_token_enc), token_expires_at = ?,
           refresh_expires_at = COALESCE(?, refresh_expires_at), token_issued_at = ?, updated_at = ? WHERE id = ?`,
        cipher.encrypt(fresh.access_token),
        cipher.encrypt(fresh.refresh_token),
        fresh.token_expires_at,
        fresh.refresh_expires_at,
        t,
        t,
        acc.id,
      );
      return load(acc.id);
    } catch (err) {
      if (err.auth) markExpired(acc, err.message);
      else logger.warn(`[contas] falha ao renovar token da conta ${acc.id}: ${err.message}`);
      if (err.auth) throw err;
      return acc;
    }
  }

  async function refreshAll() {
    const rows = db.all("SELECT id FROM accounts WHERE mode = 'live' AND status = 'active' AND token_expires_at IS NOT NULL");
    for (const { id } of rows) {
      const acc = load(id);
      // Token vencido sem como renovar: marca logo, em vez de esperar o próximo post falhar.
      if (acc.token_expires_at < now() && !(acc.platform === 'tiktok' && acc.refresh_expires_at > now())) {
        markExpired(acc, 'o acesso venceu');
        continue;
      }
      await ensureFresh(acc).catch(() => {});
    }
  }

  return { load, serialize, upsert, markExpired, ensureFresh, refreshAll, assertRoom };
}
