/**
 * Input analysis: URL detection, inline calculator, !bang site searches,
 * plus small formatting helpers shared by the UI.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  // -------------------------------------------------------------------------
  // Bangs — the same list Helium uses natively (Kagi bangs + Helium extras,
  // ~10k sites). The full list is loaded on demand with setBangs(); until then
  // a few popular ones work, with identical triggers and URLs.
  // Row format: [name, "trigger1 trigger2 …", urlTemplate, flags?, category?]
  // -------------------------------------------------------------------------

  const DEFAULT_ROWS = [
    ['Wikipedia', 'w wiki wikipedia', 'https://wikipedia.org/w/index.php?search={searchTerms}'],
    ['Google', 'g google', 'https://www.google.com/search?q={searchTerms}'],
    ['YouTube', 'yt youtube', 'https://www.youtube.com/results?search_query={searchTerms}'],
    ['GitHub', 'gh github', 'https://github.com/search?q={searchTerms}'],
    ['DuckDuckGo', 'ddg duckduckgo', 'https://duckduckgo.com/?q={searchTerms}'],
    ['Brave Search', 'brave', 'https://search.brave.com/search?q={searchTerms}'],
    ['Reddit', 'r reddit', 'https://www.reddit.com/search?q={searchTerms}'],
    ['Amazon.com', 'a amazon', 'https://www.amazon.com/s?k={searchTerms}'],
    ['StackOverflow', 'so stackoverflow', 'https://stackoverflow.com/search?q={searchTerms}'],
    ['MDN Web Docs', 'mdn', 'https://developer.mozilla.org/search?q={searchTerms}'],
    ['npm', 'npm', 'https://www.npmjs.com/search?q={searchTerms}'],
    ['Google Maps', 'gm', 'https://maps.google.com/maps?q={searchTerms}'],
    ['Wolfram Alpha', 'wa', 'https://wolframalpha.com/input?i={searchTerms}'],
    ['Hacker News', 'hn', 'https://hn.algolia.com/?q={searchTerms}', 14],
  ];

  // Shown for a bare "!" — the most useful ones first.
  const POPULAR = ['w', 'g', 'yt', 'gh', 'ddg', 'brave', 'r', 'a', 'so', 'mdn', 'npm', 'gm', 'wa', 'hn'];

  // "f" bitmask from the source data (Kagi/DDG "fmt" semantics).
  const F_OPEN_BASE = 1;
  const F_ENCODE = 2;
  const F_SPACE_PLUS = 4;

  let bangIndex = null;
  let baseRows = DEFAULT_ROWS;
  let userRows = [];
  let userKey = '[]';
  let fullListLoaded = false;

  function buildIndex(rows) {
    const map = new Map();
    const sorted = [];
    rows.forEach(([name, triggers, url, flags, category], index) => {
      const entry = { name, triggers: triggers.split(' '), url, flags: flags || 0, ai: category === 'ai', user: category === 'user', index };
      for (const t of entry.triggers) {
        const key = t.toLowerCase();
        if (map.has(key)) continue;
        map.set(key, entry);
        sorted.push(key);
      }
    });
    sorted.sort();
    return { map, sorted };
  }

  function index() {
    // Your own bangs come first, so they win over Helium's on the same trigger.
    bangIndex ??= buildIndex([...userRows, ...baseRows]);
    return bangIndex;
  }

  /** Install the full bang list (rows in the compact format above). */
  function setBangs(rows) {
    baseRows = rows;
    bangIndex = null;
    fullListLoaded = true;
  }

  const hasFullBangs = () => fullListLoaded;

  /** Install your own bangs ([{ trigger, name, url with %s }], from the settings). */
  function setUserBangs(list) {
    const key = JSON.stringify(list || []);
    if (key === userKey) return;
    userKey = key;
    userRows = (list || []).map((b) => [b.name, b.trigger, b.url.replaceAll('%s', '{searchTerms}'), 0, 'user']);
    bangIndex = null;
  }

  /** A user-facing bang object for a trigger. */
  function bangFor(trigger) {
    const entry = index().map.get(trigger.toLowerCase());
    if (!entry) return null;
    let host = '';
    try {
      host = new URL(entry.url.replaceAll('{searchTerms}', '')).hostname.replace(/^www\./, '');
    } catch {
      /* ignore */
    }
    return { key: trigger.toLowerCase(), name: entry.name, url: entry.url, flags: entry.flags, ai: entry.ai, user: entry.user, host, entry };
  }

  function encodeTerms(bang, query) {
    const f = bang.flags;
    // No flags = defaults: encode the query; spaces become "+" in the query string.
    const encode = !f || f & F_ENCODE;
    const plus = f ? f & F_SPACE_PLUS : bang.url.indexOf('{searchTerms}') > bang.url.indexOf('?') && bang.url.includes('?');
    let s = encode ? encodeURIComponent(query) : query;
    if (plus) s = encode ? s.replace(/%20/g, '+') : s.replace(/ /g, '+');
    return s;
  }

  function bangUrl(bang, query) {
    return bang.url.replaceAll('{searchTerms}', encodeTerms(bang, query));
  }

  /** Where a bang with no query goes: the site itself. */
  function bangHome(bang) {
    try {
      return new URL(bang.url.replaceAll('{searchTerms}', '')).origin;
    } catch {
      return bang.url;
    }
  }

  /** Bangs whose trigger starts with `typed`: exact match first, then shortest trigger. */
  function suggestBangs(typed, limit = 8) {
    const { map, sorted } = index();
    if (!typed) return POPULAR.map(bangFor).filter(Boolean).slice(0, limit);
    const t = typed.toLowerCase();
    // Binary search for the first trigger >= t.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < t) lo = mid + 1;
      else hi = mid;
    }
    const hits = [];
    for (let i = lo; i < sorted.length && sorted[i].startsWith(t) && hits.length < 400; i++) hits.push(sorted[i]);
    hits.sort((a, b) => (a === t ? -1 : b === t ? 1 : a.length - b.length || map.get(a).index - map.get(b).index));
    const seen = new Set();
    const out = [];
    for (const key of hits) {
      const entry = map.get(key);
      if (seen.has(entry)) continue;
      seen.add(entry);
      out.push(bangFor(key));
      if (out.length >= limit) break;
    }
    return out;
  }

  /**
   * "!yt lofi" / "lofi !yt"  -> { kind:'search', bang, query, url }
   * "!w " (bang + space)     -> { kind:'home', bang, url }   (opens the site)
   * "!y" (no space yet)      -> { kind:'partial', typed:'y', matches:[...] }
   */
  function parseBang(input) {
    const text = input.trim();
    if (!text.includes('!')) return null;

    const partial = /^!(\S*)$/.exec(text);
    if (partial) {
      const typed = partial[1];
      const exact = typed && bangFor(typed);
      // "!w " — the user finished the trigger without a query.
      if (exact && /\s$/.test(input)) return { kind: 'home', bang: exact, url: bangHome(exact) };
      return { kind: 'partial', typed: typed.toLowerCase(), matches: suggestBangs(typed) };
    }

    const tokens = text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.length < 2 || t[0] !== '!') continue;
      const bang = bangFor(t.slice(1));
      if (!bang) continue;
      const query = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(' ').trim();
      if (!query) return { kind: 'home', bang, url: bangHome(bang) };
      return { kind: 'search', bang, query, url: bangUrl(bang, query) };
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // URL detection
  // -------------------------------------------------------------------------

  const TLDS = new Set(
    (
      'com net org io dev app ai co me so sh gg xyz info biz edu gov mil int tv fm ly to cc ' +
      'de at ch uk us ca au nz fr nl be lu es pt it se no dk fi is pl cz sk hu ro bg gr tr ru ua ' +
      'jp cn kr in sg hk tw br mx ar cl za eu page site online tech store blog cloud codes ' +
      'zone wiki news live email design studio space works today run lol ninja rocks ' +
      'rs gl ms vc im ee lt lv si hr ws nu pw ie il ir id th vn my ph pk ng ke eg ma ' +
      'link click top fun club shop website network systems tools social media ' +
      'local localhost internal test onion arpa'
    ).split(/\s+/),
  );

  /** @returns {string|null} a normalised URL if the input looks like one. */
  function detectUrl(input) {
    const text = input.trim();
    if (!text || /\s/.test(text)) return null;
    if (/^javascript:/i.test(text)) return null;

    // Explicit scheme
    if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(text)) return text;
    if (/^(mailto:[^@\s]+@\S+|tel:\+?[\d().-]+)$/i.test(text)) return text;
    if (/^(about|chrome|helium):[\w/-]+$/i.test(text)) return text.replace(/^helium:(?!\/\/)/i, 'chrome://');

    // localhost / IPv4 with optional port & path
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d{1,5})?([/?#]\S*)?$/i.test(text)) return `http://${text}`;

    // domain.tld[:port][/path]
    const m = /^((?:[a-z0-9\p{L}](?:[a-z0-9\p{L}-]*[a-z0-9\p{L}])?\.)+)([a-z\p{L}]{2,})(:\d{1,5})?([/?#]\S*)?$/iu.exec(text);
    if (m && TLDS.has(m[2].toLowerCase())) return `https://${text}`;
    // Unlisted TLDs ("my.example.berlin/path", "intranet.corp:8080") count once
    // there's a port or a path; a bare "readme.md" or "script.js" stays a search.
    if (m && (m[3] || (m[4] && m[4].length > 1))) return `https://${text}`;

    return null;
  }

  // -------------------------------------------------------------------------
  // Calculator (no eval — tiny recursive-descent parser)
  // -------------------------------------------------------------------------

  const FUNCS = {
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    log: Math.log10,
    ln: Math.log,
    log2: Math.log2,
    exp: Math.exp,
  };
  const CONSTS = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

  function tokenizeMath(src) {
    const tokens = [];
    const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/\*\*/g, '^');
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) {
        i++;
      } else if (/[0-9.]/.test(ch)) {
        const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
        if (!m) throw new Error('bad number');
        tokens.push({ t: 'num', v: parseFloat(m[0]) });
        i += m[0].length;
      } else if (/[a-z]/i.test(ch)) {
        const m = /^[a-z][a-z0-9]*/i.exec(s.slice(i));
        tokens.push({ t: 'id', v: m[0].toLowerCase() });
        i += m[0].length;
      } else if ('+-*/%^()'.includes(ch)) {
        tokens.push({ t: 'op', v: ch });
        i++;
      } else {
        throw new Error(`bad char ${ch}`);
      }
    }
    return tokens;
  }

  function evaluate(src) {
    const tokens = tokenizeMath(src);
    let pos = 0;
    const peek = () => tokens[pos];
    const isOp = (v) => peek()?.t === 'op' && peek().v === v;
    const eat = (v) => {
      if (!isOp(v)) throw new Error(`expected ${v}`);
      pos++;
    };

    function expr() {
      let v = term();
      while (isOp('+') || isOp('-')) {
        const op = tokens[pos++].v;
        const r = term();
        v = op === '+' ? v + r : v - r;
      }
      return v;
    }
    function term() {
      let v = unary();
      while (isOp('*') || isOp('/') || isOp('%')) {
        const op = tokens[pos++].v;
        const r = unary();
        v = op === '*' ? v * r : op === '/' ? v / r : v % r;
      }
      return v;
    }
    function unary() {
      if (isOp('-')) {
        pos++;
        return -unary();
      }
      if (isOp('+')) {
        pos++;
        return unary();
      }
      return power();
    }
    function power() {
      const base = primary();
      if (isOp('^')) {
        pos++;
        return base ** unary();
      }
      return base;
    }
    function primary() {
      const tok = peek();
      if (!tok) throw new Error('unexpected end');
      if (tok.t === 'num') {
        pos++;
        return tok.v;
      }
      if (tok.t === 'id') {
        pos++;
        if (FUNCS[tok.v]) {
          eat('(');
          const v = expr();
          eat(')');
          return FUNCS[tok.v](v);
        }
        if (tok.v in CONSTS) return CONSTS[tok.v];
        throw new Error(`unknown ${tok.v}`);
      }
      if (isOp('(')) {
        pos++;
        const v = expr();
        eat(')');
        return v;
      }
      throw new Error('unexpected token');
    }

    const value = expr();
    if (pos !== tokens.length) throw new Error('trailing input');
    return value;
  }

  function formatNumber(n) {
    if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
    const s = Number(n.toPrecision(12)).toString();
    return s;
  }

  /**
   * Dates, phone numbers and codes that happen to parse as arithmetic:
   * "2026-11-18", "10/12/2024", "1-800-555-1234" (three or more digit groups
   * joined by - or /, no spaces), and groups with a leading zero ("0171-12345",
   * "09/2025"). "100-25" or "10 - 3 - 2" still calculate.
   */
  function looksLikeDateOrNumberCode(text) {
    if (!/^\d+([-/]\d+)+$/.test(text)) return false;
    const groups = text.split(/[-/]/);
    return groups.length >= 3 || groups.some((g) => g.length > 1 && g[0] === '0');
  }

  /** @returns {{expr:string, value:number, display:string}|null} */
  function calculate(input) {
    const text = input.trim().replace(/=$/, '').trim();
    if (!text || !/\d|pi|tau/i.test(text)) return null;
    // Needs an operator or a function call — a bare number is not a calculation.
    if (!/[+\-*/%^×÷()]/.test(text.replace(/^[-+]/, ''))) return null;
    if (/^[\d.]+$/.test(text)) return null;
    if (looksLikeDateOrNumberCode(text)) return null;
    try {
      const value = evaluate(text);
      if (!Number.isFinite(value)) return null;
      return { expr: text, value, display: formatNumber(value) };
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------------

  /** "[title](url)" with the title's brackets escaped and the URL's spaces/parentheses encoded. */
  function markdownLink(title, url) {
    const t = (title || url).replace(/([[\]\\])/g, '\\$1');
    const u = url.replace(/ /g, '%20').replace(/\(/g, '%28').replace(/\)/g, '%29');
    return `[${t}](${u})`;
  }

  /** Tabs as one URL per line, or as a Markdown list of links. */
  function formatTabList(tabs, format) {
    return tabs.map((t) => (format === 'markdown' ? `- ${markdownLink(t.title, t.url)}` : t.url)).join('\n');
  }

  function displayUrl(url) {
    if (!url) return '';
    return url
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .replace(/\/$/, '');
  }

  function relativeTime(ts, now = Date.now()) {
    if (!ts) return '';
    const s = Math.max(0, (now - ts) / 1000);
    if (s < 60) return 'now';
    const m = s / 60;
    if (m < 60) return `${Math.floor(m)}m`;
    const h = m / 60;
    if (h < 24) return `${Math.floor(h)}h`;
    const d = h / 24;
    if (d < 7) return `${Math.floor(d)}d`;
    if (d < 30) return `${Math.floor(d / 7)}w`;
    if (d < 365) return `${Math.floor(d / 30)}mo`;
    return `${Math.floor(d / 365)}y`;
  }

  Z.parse = { setBangs, setUserBangs, hasFullBangs, suggestBangs, bangFor, bangHome, parseBang, bangUrl, detectUrl, calculate, evaluate, displayUrl, relativeTime, markdownLink, formatTabList };
})();
