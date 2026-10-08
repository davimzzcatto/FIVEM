import { monthlyUsage, planOf } from '../plans.js';

const DAY = 86_400_000;

function zonedParts(at, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', weekday: 'short' })
      .formatToParts(new Date(at))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24, weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

export function registerInsightRoutes(router, { db, posts, accounts, now }) {
  router.add('GET', '/api/dashboard', ({ user }) => {
    const t = now();
    const count = (sql, ...p) => db.get(sql, user.id, ...p).n;
    const scheduled = count("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND status IN ('scheduled','publishing')");
    const published30 = count("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND status = 'published' AND published_at > ?", t - 30 * DAY);
    const failed30 = count("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND status = 'failed' AND updated_at > ?", t - 30 * DAY);
    const failedOpen = count("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND status = 'failed' AND updated_at > ?", t - 7 * DAY);
    const next = db.all("SELECT * FROM posts WHERE user_id = ? AND status IN ('scheduled','publishing') ORDER BY scheduled_at LIMIT 8", user.id);
    const last = db.all("SELECT * FROM posts WHERE user_id = ? AND status = 'published' ORDER BY published_at DESC LIMIT 1", user.id);
    const accs = db.all('SELECT * FROM accounts WHERE user_id = ? ORDER BY platform, username', user.id).map(accounts.serialize);
    return {
      plan: planOf(user),
      usage: monthlyUsage(db, user, t),
      counts: {
        scheduled,
        published30,
        failed30,
        failedOpen,
        successRate: published30 + failed30 ? Math.round((published30 / (published30 + failed30)) * 1000) / 10 : null,
      },
      next: posts.serializeMany(next, user.id),
      last: posts.serializeMany(last, user.id)[0] || null,
      accounts: accs,
    };
  });

  router.add('GET', '/api/logs', ({ user, query }) => {
    const where = ['l.user_id = ?'];
    const params = [user.id];
    if (query.level) where.push('l.level = ?'), params.push(String(query.level));
    if (query.before) where.push('l.id < ?'), params.push(Number(query.before));
    if (query.post_id) where.push('l.post_id = ?'), params.push(Number(query.post_id));
    const limit = Math.min(Number(query.limit) || 50, 200);
    return db.all(
      `SELECT l.*, a.username, a.platform, p.status AS post_status FROM logs l
       LEFT JOIN accounts a ON a.id = l.account_id LEFT JOIN posts p ON p.id = l.post_id
       WHERE ${where.join(' AND ')} ORDER BY l.id DESC LIMIT ?`,
      ...params,
      limit,
    );
  });

  router.add('GET', '/api/analytics', ({ user, query }) => {
    const days = [7, 30, 90].includes(Number(query.days)) ? Number(query.days) : 30;
    const t = now();
    const since = t - days * DAY;
    const ws = query.workspace_id ? Number(query.workspace_id) : null;
    const rows = db.all(
      `SELECT p.status, p.type, p.scheduled_at, p.published_at, p.updated_at, a.platform FROM posts p JOIN accounts a ON a.id = p.account_id
       WHERE p.user_id = ? AND p.status IN ('published','failed') AND COALESCE(p.published_at, p.updated_at) > ? ${ws ? 'AND p.workspace_id = ?' : ''}`,
      user.id,
      since,
      ...(ws ? [ws] : []),
    );

    const perDay = new Map();
    for (let d = days - 1; d >= 0; d--) perDay.set(zonedParts(t - d * DAY, user.timezone).date, { published: 0, failed: 0 });
    const byPlatform = {};
    const byType = {};
    const heat = Array.from({ length: 7 }, () => Array(24).fill(0));
    let published = 0;
    let failed = 0;
    for (const r of rows) {
      const at = r.status === 'published' ? r.published_at : r.updated_at;
      const z = zonedParts(at, user.timezone);
      const day = perDay.get(z.date);
      if (day) day[r.status]++;
      if (r.status === 'published') {
        published++;
        byPlatform[r.platform] = (byPlatform[r.platform] || 0) + 1;
        byType[r.type] = (byType[r.type] || 0) + 1;
        heat[z.weekday][z.hour]++;
      } else failed++;
    }
    const upcoming = db.get("SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND status = 'scheduled' AND scheduled_at < ?", user.id, t + 7 * DAY).n;
    return {
      days,
      totals: { published, failed, successRate: published + failed ? Math.round((published / (published + failed)) * 1000) / 10 : null, upcoming7: upcoming },
      perDay: [...perDay].map(([date, v]) => ({ date, ...v })),
      byPlatform,
      byType,
      heatmap: heat,
    };
  });
}
