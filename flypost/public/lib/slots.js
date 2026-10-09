// Distribuição automática de horários para um lote de posts.
// Trabalha no fuso local de quem chama (o navegador, no app).

export const SUGGESTED_TIMES = ['08:30', '12:00', '18:30', '21:00'];

const MIN_LEAD_MS = 2 * 60 * 1000; // não marca nada para os próximos 2 minutos
const MAX_DAYS = 400;

function parseTime(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm).trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  return h < 24 && min < 60 ? h * 60 + min : null;
}

export function normalizeTimes(times) {
  const mins = [...new Set(times.map(parseTime).filter((v) => v != null))].sort((a, b) => a - b);
  return mins.map((v) => `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`);
}

function dayStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Horários fixos: preenche cada dia com os horários da lista, pulando o que já passou.
export function fixedSlots({ count, startDate, times, perDay, weekdays, now = Date.now() }) {
  const list = normalizeTimes(times).map(parseTime);
  if (!count || !list.length || !startDate) return [];
  const limit = Math.max(1, Math.min(perDay || list.length, list.length));
  const allowed = weekdays && weekdays.length ? new Set(weekdays) : null;
  const out = [];
  const day = dayStart(startDate);
  for (let d = 0; d < MAX_DAYS && out.length < count; d++) {
    if (!allowed || allowed.has(day.getDay())) {
      let used = 0;
      for (const minutes of list) {
        if (used >= limit || out.length >= count) break;
        const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60).getTime();
        if (at < now + MIN_LEAD_MS) continue;
        out.push(at);
        used++;
      }
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}

// Intervalo: a partir de um início, um post a cada N minutos dentro da janela do dia.
export function intervalSlots({ count, start, everyMinutes, windowStart = '00:00', windowEnd = '23:59', weekdays, now = Date.now() }) {
  const step = Math.max(5, Number(everyMinutes) || 0) * 60 * 1000;
  const from = parseTime(windowStart) ?? 0;
  const to = parseTime(windowEnd) ?? 24 * 60 - 1;
  if (!count || !step || from > to) return [];
  const allowed = weekdays && weekdays.length ? new Set(weekdays) : null;
  const out = [];
  let t = Math.max(Number(start) || now, now + MIN_LEAD_MS);
  for (let guard = 0; guard < 100_000 && out.length < count; guard++) {
    const d = new Date(t);
    const minutes = d.getHours() * 60 + d.getMinutes();
    const okDay = !allowed || allowed.has(d.getDay());
    if (okDay && minutes >= from && minutes <= to) {
      out.push(t);
      t += step;
      continue;
    }
    // fora da janela: pula para o início da janela (hoje, se ainda não chegou; senão amanhã)
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(from / 60), from % 60);
    if (!okDay || minutes > to) next.setDate(next.getDate() + 1);
    t = next.getTime();
  }
  return out;
}
