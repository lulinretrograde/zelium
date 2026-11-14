/**
 * Small fuzzy matcher in the spirit of Zed's file finder.
 *
 * - Every query token (split on whitespace) must match, in order, as a
 *   subsequence of at least one field (e.g. title or URL).
 * - Consecutive characters, word starts and the start of the string score
 *   higher; gaps cost a little.
 * - Returns the matched character positions per field for highlighting.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  const isAlnum = (ch) => /[\p{L}\p{N}]/u.test(ch);

  function isBoundary(text, i) {
    if (i === 0) return true;
    const prev = text[i - 1];
    const ch = text[i];
    if (!isAlnum(prev)) return true;
    // camelCase boundary: "gitHub" -> H
    return prev === prev.toLowerCase() && ch !== ch.toLowerCase() && /\p{Ll}/u.test(prev);
  }

  function scorePositions(text, positions) {
    let score = 0;
    let prev = -2;
    let run = 0;
    for (const p of positions) {
      let s = 1;
      if (p === prev + 1) {
        run++;
        s += 4 + Math.min(run, 4) * 1.5;
      } else {
        run = 0;
        if (prev >= 0) s -= Math.min(p - prev - 1, 10) * 0.15;
      }
      if (isBoundary(text, p)) s += 6;
      if (p === 0) s += 4;
      score += s;
      prev = p;
    }
    score -= Math.min(positions[0], 20) * 0.05;
    return score;
  }

  /**
   * Match a single (lower-cased) token against text.
   * @returns {{score:number, positions:number[]}|null}
   */
  function matchToken(token, text) {
    if (!token) return { score: 0, positions: [] };
    if (!text) return null;
    const lower = text.toLowerCase();
    const n = token.length;
    let best = null;
    let tries = 0;
    for (let start = lower.indexOf(token[0]); start !== -1 && tries < 32; start = lower.indexOf(token[0], start + 1), tries++) {
      const positions = [start];
      let ti = 1;
      for (let i = start + 1; ti < n && i < lower.length; i++) {
        if (lower[i] === token[ti]) {
          positions.push(i);
          ti++;
        }
      }
      // If a greedy match fails from this start it fails from every later start too.
      if (ti < n) break;
      const score = scorePositions(text, positions);
      if (!best || score > best.score) best = { score, positions };
    }
    return best;
  }

  function tokenize(query) {
    return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  }

  /**
   * Score an item with several text fields.
   * @param {string[]} tokens   lower-cased query tokens
   * @param {string[]} fields   field texts
   * @param {number[]} weights  per-field weight
   * @returns {{score:number, hl:Set<number>[]}|null}
   */
  function scoreFields(tokens, fields, weights = []) {
    if (!tokens.length) return { score: 0, hl: fields.map(() => new Set()) };
    const hl = fields.map(() => new Set());
    let total = 0;
    for (const token of tokens) {
      let best = null;
      let bestField = -1;
      for (let f = 0; f < fields.length; f++) {
        const m = matchToken(token, fields[f]);
        if (!m) continue;
        const weighted = m.score * (weights[f] ?? 1);
        if (!best || weighted > best.weighted) {
          best = { weighted, positions: m.positions };
          bestField = f;
        }
      }
      if (!best) return null;
      total += best.weighted;
      for (const p of best.positions) hl[bestField].add(p);
    }
    // Bonus when the primary field starts with the whole query.
    const q = tokens.join(' ');
    const primary = (fields[0] || '').toLowerCase();
    if (primary.startsWith(q)) total += 10;
    else if (primary.includes(q)) total += 4;
    return { score: total, hl };
  }

  /**
   * Rank a list.
   * @param {string} query
   * @param {any[]} items
   * @param {(item:any)=>string[]} fieldsOf
   * @param {{weights?:number[], limit?:number, boost?:(item:any)=>number, minScore?:number}} opts
   * @returns {{item:any, score:number, hl:Set<number>[]}[]}
   */
  function rank(query, items, fieldsOf, opts = {}) {
    const tokens = tokenize(query);
    const { weights, limit = Infinity, boost, minScore = -Infinity } = opts;
    const out = [];
    for (const item of items) {
      const r = scoreFields(tokens, fieldsOf(item), weights);
      // Threshold on match quality alone; boosts only reorder good matches.
      if (!r || r.score < minScore) continue;
      const score = r.score + (boost ? boost(item) : 0);
      out.push({ item, score, hl: r.hl });
    }
    out.sort((a, b) => b.score - a.score);
    return out.length > limit ? out.slice(0, limit) : out;
  }

  Z.fuzzy = { matchToken, scoreFields, rank, tokenize, isBoundary };
})();
