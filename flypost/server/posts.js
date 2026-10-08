import { randomToken } from './crypto.js';
import { HttpError, badRequest, notFound } from './http.js';
import { planOf, monthRange } from './plans.js';
import { PLATFORMS, TYPES, RECOMMENDED_PER_DAY, validatePost, maxInWindow } from '../public/lib/rules.js';
import { spinMany } from '../public/lib/spintax.js';

const DAY = 86_400_000;
const MAX_ITEMS = 500;
const EDITABLE = ['draft', 'scheduled', 'failed'];
const TIKTOK_PRIVACY = ['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY'];

// Aceita milissegundos ou data ISO 8601 ("2026-11-03T18:30:00-03:00").
export function parseWhen(v) {
  if (typeof v === 'string' && v.trim() && Number.isNaN(Number(v))) return Date.parse(v);
  return v == null || v === '' ? NaN : Number(v);
}

const fmtDay = (at, tz) => new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit' }).format(new Date(at));

export function createPosts({ db, media, accounts, now = Date.now, random = Math.random }) {
  function serializeMany(rows, userId) {
    const mediaIds = [...new Set(rows.flatMap((r) => JSON.parse(r.media_ids)))];
    const mediaMap = new Map(media.byIds(userId, mediaIds).map((m) => [m.id, media.serialize(m)]));
    const accIds = [...new Set(rows.map((r) => r.account_id))];
    const accMap = new Map(
      accIds.length ? db.all(`SELECT * FROM accounts WHERE id IN (${accIds.map(() => '?').join(',')})`, ...accIds).map((a) => [a.id, accounts.serialize(a)]) : [],
    );
    return rows.map((r) => ({
      id: r.id,
      workspace_id: r.workspace_id,
      account: accMap.get(r.account_id) || null,
      batch_id: r.batch_id,
      type: r.type,
      caption: r.caption,
      first_comment: r.first_comment,
      media: JSON.parse(r.media_ids).map((id) => mediaMap.get(id) || { id, missing: true }),
      options: JSON.parse(r.options_json || '{}'),
      scheduled_at: r.scheduled_at,
      status: r.status,
      attempts: r.attempts,
      next_attempt_at: r.next_attempt_at,
      last_error: r.last_error,
      remote_id: r.remote_id,
      permalink: r.permalink,
      published_at: r.published_at,
      source: r.source,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
  }

  function getOwned(user, id) {
    const row = db.get('SELECT * FROM posts WHERE id = ? AND user_id = ?', Number(id), user.id);
    if (!row) throw notFound('Post não encontrado.');
    return row;
  }

  function list(user, q = {}) {
    const where = ['p.user_id = ?'];
    const params = [user.id];
    if (q.from) where.push('p.scheduled_at >= ?'), params.push(Number(q.from));
    if (q.to) where.push('p.scheduled_at < ?'), params.push(Number(q.to));
    if (q.status) {
      const statuses = String(q.status).split(',');
      where.push(`p.status IN (${statuses.map(() => '?').join(',')})`);
      params.push(...statuses);
    }
    if (q.workspace_id) where.push('p.workspace_id = ?'), params.push(Number(q.workspace_id));
    if (q.account_id) where.push('p.account_id = ?'), params.push(Number(q.account_id));
    if (q.batch_id) where.push('p.batch_id = ?'), params.push(String(q.batch_id));
    const limit = Math.min(Math.max(Number(q.limit) || 200, 1), 1000);
    const order = q.order === 'desc' ? 'DESC' : 'ASC';
    const rows = db.all(`SELECT p.* FROM posts p WHERE ${where.join(' AND ')} ORDER BY p.scheduled_at ${order}, p.id LIMIT ?`, ...params, limit);
    return serializeMany(rows, user.id);
  }

  function sanitizeOptions(user, raw = {}) {
    const o = {};
    if (raw.share_to_feed != null) o.share_to_feed = Boolean(raw.share_to_feed);
    if (raw.thumb_offset_ms != null && Number.isFinite(Number(raw.thumb_offset_ms))) o.thumb_offset_ms = Math.max(0, Math.round(Number(raw.thumb_offset_ms)));
    if (raw.cover_media_id) {
      const cover = media.byIds(user.id, [Number(raw.cover_media_id)])[0];
      if (!cover || cover.kind !== 'image') throw badRequest('A capa precisa ser uma imagem enviada por você.');
      o.cover_media_id = cover.id;
    }
    if (raw.tiktok_privacy) {
      if (!TIKTOK_PRIVACY.includes(raw.tiktok_privacy)) throw badRequest('Privacidade do TikTok inválida.');
      o.tiktok_privacy = raw.tiktok_privacy;
    }
    for (const k of ['disable_comment', 'disable_duet', 'disable_stitch']) if (raw[k] != null) o[k] = Boolean(raw[k]);
    return o;
  }

  // Confere o limite do plano no mês e o teto de posts por conta em 24h.
  // entries: [{ account, at }] novos; ignore: ids de posts que estão sendo substituídos.
  function checkLimits(user, entries, ignore = []) {
    const errors = [];
    const warnings = [];
    const skip = new Set(ignore);

    const byMonth = new Map();
    for (const e of entries) {
      const m = monthRange(e.at, user.timezone);
      const slot = byMonth.get(m.key) || { ...m, n: 0 };
      slot.n++;
      byMonth.set(m.key, slot);
    }
    const plan = planOf(user);
    for (const m of byMonth.values()) {
      const existing = db
        .all("SELECT id FROM posts WHERE user_id = ? AND scheduled_at >= ? AND scheduled_at < ? AND status IN ('scheduled','publishing','published')", user.id, m.start, m.end)
        .filter((r) => !skip.has(r.id)).length;
      if (existing + m.n > plan.postsPerMonth) {
        errors.push(`Limite do plano ${plan.name} em ${m.key}: ${plan.postsPerMonth} posts. Já há ${existing} e este lote soma ${m.n}.`);
      }
    }

    const byAccount = new Map();
    for (const e of entries) {
      const list = byAccount.get(e.account.id) || { account: e.account, times: [] };
      list.times.push(e.at);
      byAccount.set(e.account.id, list);
    }
    for (const { account, times } of byAccount.values()) {
      const lo = Math.min(...times) - DAY;
      const hi = Math.max(...times) + DAY;
      const existing = db
        .all("SELECT id, scheduled_at FROM posts WHERE account_id = ? AND scheduled_at > ? AND scheduled_at < ? AND status IN ('scheduled','publishing','published')", account.id, lo, hi)
        .filter((r) => !skip.has(r.id))
        .map((r) => r.scheduled_at);
      const all = [...existing, ...times];
      const cap = PLATFORMS[account.platform].perDay;
      const peak = maxInWindow(all);
      if (peak > cap) {
        errors.push(`@${account.username} passaria de ${cap} posts em 24h (${PLATFORMS[account.platform].label}). Espalhe os horários por mais dias.`);
      } else if (peak > RECOMMENDED_PER_DAY) {
        warnings.push(`@${account.username} terá até ${peak} posts em 24h. Acima de ${RECOMMENDED_PER_DAY} por dia o alcance costuma cair.`);
      }
    }
    return { errors, warnings };
  }

  function loadAccounts(user, ids) {
    if (!Array.isArray(ids) || !ids.length) throw badRequest('Escolha pelo menos uma conta.');
    const unique = [...new Set(ids.map(Number))];
    const rows = db.all(`SELECT * FROM accounts WHERE user_id = ? AND id IN (${unique.map(() => '?').join(',')})`, user.id, ...unique);
    if (rows.length !== unique.length) throw badRequest('Alguma conta escolhida não existe.');
    return rows;
  }

  // Valida e (se não for dry_run) cria um lote: cada item vira um post em cada conta escolhida.
  function createBatch(user, input, { source = 'app' } = {}) {
    const type = input.type;
    if (!TYPES[type]) throw badRequest('Tipo de publicação inválido.');
    const accs = loadAccounts(user, input.account_ids);
    const items = Array.isArray(input.items) ? input.items : [];
    if (!items.length) throw badRequest('Nenhum post no lote.');
    if (items.length > MAX_ITEMS) throw badRequest(`No máximo ${MAX_ITEMS} posts por lote.`);

    const t = now();
    const errors = [];
    const entries = [];
    const allMediaIds = [...new Set(items.flatMap((it) => (Array.isArray(it.media_ids) ? it.media_ids.map(Number) : [])))];
    const mediaMap = new Map(media.byIds(user.id, allMediaIds).map((m) => [m.id, m]));

    for (const acc of accs) {
      if (acc.status === 'expired') errors.push(`@${acc.username} precisa ser reconectada antes de agendar.`);
      if (acc.status === 'disabled') errors.push(`@${acc.username} está desativada.`);
    }

    const prepared = items.map((it, index) => {
      const ids = Array.isArray(it.media_ids) ? it.media_ids.map(Number) : [];
      const files = ids.map((id) => mediaMap.get(id));
      if (files.some((f) => !f)) errors.push(`Post ${index + 1}: mídia não encontrada.`);
      let at = input.publish_now ? t : parseWhen(it.scheduled_at);
      if (!Number.isFinite(at)) errors.push(`Post ${index + 1}: data e hora inválidas.`);
      else if (at < t - 60_000) errors.push(`Post ${index + 1}: o horário ${fmtDay(at, user.timezone)} já passou.`);
      else if (at > t + 400 * DAY) errors.push(`Post ${index + 1}: agende com até um ano de antecedência.`);
      at = Math.max(at, t);
      const caption = String(it.caption ?? input.caption ?? '');
      const firstComment = String(it.first_comment ?? input.first_comment ?? '');
      const captions = input.spintax ? spinMany(caption, accs.length, random) : accs.map(() => caption);
      const comments = input.spintax ? spinMany(firstComment, accs.length, random) : accs.map(() => firstComment);
      return { index, ids, files: files.filter(Boolean), at, captions, comments, options: sanitizeOptions(user, { ...input.options, ...it.options }) };
    });

    for (const p of prepared) {
      accs.forEach((acc, k) => {
        const problems = validatePost({ platform: acc.platform, type, media: p.files, caption: p.captions[k], firstComment: p.comments[k] });
        for (const msg of problems) errors.push(`Post ${p.index + 1} → @${acc.username}: ${msg}`);
        entries.push({ account: acc, at: p.at });
      });
    }

    const limits = errors.length ? { errors: [], warnings: [] } : checkLimits(user, entries);
    const allErrors = [...new Set([...errors, ...limits.errors])];
    const summary = { posts: prepared.length * accs.length, items: prepared.length, accounts: accs.length, errors: allErrors.slice(0, 50), warnings: limits.warnings };
    if (allErrors.length) throw new HttpError(422, allErrors[0], summary);
    if (input.dry_run) return { ...summary, created: 0 };

    const batchId = randomToken(9);
    const created = db.tx(() => {
      const ids = [];
      for (const p of prepared) {
        accs.forEach((acc, k) => {
          const r = db.run(
            `INSERT INTO posts (user_id, workspace_id, account_id, batch_id, type, caption, first_comment, media_ids, options_json,
               scheduled_at, status, source, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'scheduled',?,?,?)`,
            user.id,
            acc.workspace_id,
            acc.id,
            batchId,
            type,
            p.captions[k],
            p.comments[k] || null,
            JSON.stringify(p.ids),
            JSON.stringify(p.options),
            p.at,
            source,
            t,
            t,
          );
          ids.push(Number(r.lastInsertRowid));
        });
      }
      return ids;
    });
    return { ...summary, created: created.length, batch_id: batchId, ids: created };
  }

  function update(user, id, patch) {
    const row = getOwned(user, id);
    if (!EDITABLE.includes(row.status)) throw badRequest('Só dá para editar posts que ainda não foram publicados.');
    const acc = db.get('SELECT * FROM accounts WHERE id = ?', row.account_id);
    const next = {
      caption: patch.caption != null ? String(patch.caption) : row.caption,
      first_comment: patch.first_comment !== undefined ? String(patch.first_comment || '') || null : row.first_comment,
      scheduled_at: patch.scheduled_at != null ? parseWhen(patch.scheduled_at) : row.scheduled_at,
      options: patch.options ? sanitizeOptions(user, { ...JSON.parse(row.options_json), ...patch.options }) : JSON.parse(row.options_json),
    };
    if (!Number.isFinite(next.scheduled_at)) throw badRequest('Data e hora inválidas.');
    const moved = next.scheduled_at !== row.scheduled_at;
    if (moved && next.scheduled_at < now() - 60_000) throw badRequest('Esse horário já passou.');

    const files = media.byIds(user.id, JSON.parse(row.media_ids));
    const problems = validatePost({ platform: acc.platform, type: row.type, media: files, caption: next.caption, firstComment: next.first_comment || '' });
    if (problems.length) throw new HttpError(422, problems[0], { errors: problems });

    // Post com falha que ganha horário novo volta para a fila.
    const status = row.status === 'failed' && moved ? 'scheduled' : row.status;
    let warnings = [];
    if (status === 'scheduled' && (moved || row.status !== 'scheduled')) {
      const lim = checkLimits(user, [{ account: acc, at: next.scheduled_at }], [row.id]);
      if (lim.errors.length) throw new HttpError(422, lim.errors[0], lim);
      warnings = lim.warnings;
    }
    db.run(
      `UPDATE posts SET caption = ?, first_comment = ?, scheduled_at = ?, options_json = ?, status = ?,
         attempts = CASE WHEN ? THEN 0 ELSE attempts END, next_attempt_at = NULL, updated_at = ? WHERE id = ?`,
      next.caption,
      next.first_comment,
      next.scheduled_at,
      JSON.stringify(next.options),
      status,
      status !== row.status,
      now(),
      row.id,
    );
    return { post: serializeMany([db.get('SELECT * FROM posts WHERE id = ?', row.id)], user.id)[0], warnings };
  }

  // Joga o post para agora (publicar já ou tentar de novo uma falha).
  function requeue(user, id) {
    const row = getOwned(user, id);
    if (!['scheduled', 'failed'].includes(row.status)) throw badRequest('Esse post não pode ser publicado agora.');
    if (row.status === 'failed') {
      const acc = db.get('SELECT * FROM accounts WHERE id = ?', row.account_id);
      const lim = checkLimits(user, [{ account: acc, at: now() }], [row.id]);
      if (lim.errors.length) throw new HttpError(422, lim.errors[0], lim);
    }
    db.run("UPDATE posts SET status = 'scheduled', scheduled_at = ?, attempts = 0, next_attempt_at = NULL, last_error = NULL, updated_at = ? WHERE id = ?", now(), now(), row.id);
  }

  function cancel(user, id) {
    const row = getOwned(user, id);
    if (row.status !== 'scheduled') throw badRequest('Só posts agendados podem ser cancelados.');
    db.run("UPDATE posts SET status = 'canceled', updated_at = ? WHERE id = ?", now(), row.id);
  }

  function remove(user, id) {
    const row = getOwned(user, id);
    if (row.status === 'publishing') throw badRequest('Esse post está sendo publicado agora. Espere terminar.');
    db.run('DELETE FROM posts WHERE id = ?', row.id);
  }

  return { list, serializeMany, getOwned, createBatch, update, requeue, cancel, remove, checkLimits };
}
