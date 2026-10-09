// Spintax: "{Oi|Olá|E aí}, tudo bem?" vira uma das opções a cada sorteio.
// Grupos podem ser aninhados. Chaves sem "|" dentro ficam como texto normal.
// Compartilhado entre navegador e servidor.

function parse(src) {
  let i = 0;

  function seq(insideGroup) {
    const parts = [];
    let buf = '';
    const flush = () => {
      if (buf) parts.push(buf);
      buf = '';
    };
    while (i < src.length) {
      const c = src[i];
      if (c === '{') {
        const start = i;
        i++;
        const alts = [seq(true)];
        while (src[i] === '|') {
          i++;
          alts.push(seq(true));
        }
        if (src[i] !== '}') {
          // sem fechamento: a chave é literal, recomeça logo depois dela
          i = start + 1;
          buf += '{';
          continue;
        }
        i++;
        if (alts.length > 1) {
          flush();
          parts.push({ alts });
        } else {
          buf += '{';
          flush();
          parts.push(...alts[0]);
          buf = '}';
        }
        continue;
      }
      if (insideGroup && (c === '|' || c === '}')) break;
      buf += c;
      i++;
    }
    flush();
    return parts;
  }

  return seq(false);
}

function render(parts, rand) {
  let out = '';
  for (const p of parts) {
    out += typeof p === 'string' ? p : render(p.alts[Math.floor(rand() * p.alts.length)], rand);
  }
  return out;
}

function count(parts) {
  let total = 1;
  for (const p of parts) {
    if (typeof p === 'string') continue;
    total *= p.alts.reduce((sum, alt) => sum + count(alt), 0);
    if (total > 1e9) return Infinity;
  }
  return total;
}

export function hasSpintax(text) {
  return parse(String(text || '')).some((p) => typeof p !== 'string');
}

export function countVariations(text) {
  return count(parse(String(text || '')));
}

export function spin(text, rand = Math.random) {
  return render(parse(String(text || '')), rand);
}

// Gera n textos, evitando repetir enquanto houver combinações novas.
export function spinMany(text, n, rand = Math.random) {
  const tree = parse(String(text || ''));
  const possible = count(tree);
  const out = [];
  const seen = new Set();
  for (let k = 0; k < n; k++) {
    let candidate = render(tree, rand);
    if (seen.size < possible) {
      for (let tries = 0; tries < 30 && seen.has(candidate); tries++) candidate = render(tree, rand);
    }
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}
