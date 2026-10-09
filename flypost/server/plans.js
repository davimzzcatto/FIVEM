// Limites de cada plano. Cobrança não faz parte deste app: o plano de cada usuário
// é trocado por quem administra (npm run plan -- email@dominio.com pro).

export const PLANS = {
  teste: { name: 'Teste', postsPerMonth: 30, workspaces: 1, accountsPerWorkspace: 3 },
  solo: { name: 'Solo', postsPerMonth: 400, workspaces: 1, accountsPerWorkspace: 5 },
  pro: { name: 'Pro', postsPerMonth: 2000, workspaces: 5, accountsPerWorkspace: 5 },
  agencia: { name: 'Agência', postsPerMonth: 10000, workspaces: 25, accountsPerWorkspace: 5 },
};

export function planOf(user) {
  return { id: user.plan, ...(PLANS[user.plan] || PLANS.teste) };
}

// Início e fim (ms) do mês em que `at` cai, no fuso do usuário.
export function monthRange(at, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric' })
      .formatToParts(new Date(at))
      .map((p) => [p.type, p.value]),
  );
  const y = Number(parts.year);
  const m = Number(parts.month);
  return { key: `${y}-${String(m).padStart(2, '0')}`, start: zonedMidnight(y, m, timeZone), end: zonedMidnight(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, timeZone) };
}

function offsetAt(utcMs, timeZone) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(utcMs))
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - utcMs;
}

function zonedMidnight(y, m, timeZone) {
  const guess = Date.UTC(y, m - 1, 1);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

// Posts que contam no limite do mês: os agendados, em publicação e publicados.
export const COUNTED_STATUSES = ['scheduled', 'publishing', 'published'];

export function monthlyUsage(db, user, at = Date.now()) {
  const { key, start, end } = monthRange(at, user.timezone);
  const row = db.get(
    `SELECT COUNT(*) AS n FROM posts WHERE user_id = ? AND scheduled_at >= ? AND scheduled_at < ? AND status IN ('scheduled','publishing','published')`,
    user.id,
    start,
    end,
  );
  return { month: key, used: row.n, limit: planOf(user).postsPerMonth };
}
