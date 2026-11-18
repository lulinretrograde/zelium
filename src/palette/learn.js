/**
 * Learns from what you pick: a result chosen for a query ranks higher the
 * next time you type that query (or the start of it). Kept in
 * chrome.storage.local only; nothing leaves the browser.
 *
 * Store: { "<query>\u0001<item key>": [count, lastPickedMs] }
 * Item keys are stable across sessions: "url:<url>" or "command:<id>".
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  const SEP = '\u0001';
  const MAX_ENTRIES = 500;
  const MAX_QUERY = 40;
  const HALF_LIFE_MS = 14 * 86400e3;
  const MAX_BOOST = 24;
  /** A learned boost at least this big makes the result the top hit. */
  const TOP_HIT = 6;

  const normQuery = (q) => q.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY);

  /** The stable key for a row, or null if picks of this kind aren't learned. */
  function keyFor(row) {
    switch (row?.kind) {
      case 'tab':
      case 'bookmark':
      case 'history':
      case 'url':
        return row.url ? `url:${row.url}` : null;
      case 'command':
        return `command:${row.data.id}`;
      default:
        return null;
    }
  }

  /** A new store with this pick counted; the least recently used entries go past MAX_ENTRIES. */
  function record(store, query, key, now = Date.now()) {
    const q = normQuery(query);
    if (!q || !key) return store;
    const id = q + SEP + key;
    const next = { ...store, [id]: [(store[id]?.[0] ?? 0) + 1, now] };
    const ids = Object.keys(next);
    if (ids.length > MAX_ENTRIES) {
      ids.sort((a, b) => next[a][1] - next[b][1]);
      for (const old of ids.slice(0, ids.length - MAX_ENTRIES)) delete next[old];
    }
    return next;
  }

  /**
   * Boost per item key for the current query: picks for exactly this query
   * count fully, picks for a longer query that starts with it ("gi" → picked
   * for "github") count a bit less. Fades with a two-week half-life.
   * @returns {Map<string, number>}
   */
  function boosts(store, query, now = Date.now()) {
    const q = normQuery(query);
    const out = new Map();
    if (!q) return out;
    for (const [id, [count, last]] of Object.entries(store)) {
      const i = id.indexOf(SEP);
      const pq = id.slice(0, i);
      const weight = pq === q ? 1 : pq.startsWith(q) ? 0.6 : 0;
      if (!weight) continue;
      const fade = 0.5 ** (Math.max(0, now - last) / HALF_LIFE_MS);
      const b = Math.min(MAX_BOOST, weight * fade * 8 * Math.log2(1 + count));
      const key = id.slice(i + 1);
      if (b > (out.get(key) ?? 0)) out.set(key, b);
    }
    return out;
  }

  async function load() {
    try {
      const { picks } = await chrome.storage.local.get('picks');
      return picks && typeof picks === 'object' ? picks : {};
    } catch {
      return {};
    }
  }

  const save = (store) => chrome.storage.local.set({ picks: store });
  const clear = () => chrome.storage.local.remove('picks');

  Z.learn = { keyFor, record, boosts, load, save, clear, normQuery, TOP_HIT, MAX_ENTRIES };
})();
