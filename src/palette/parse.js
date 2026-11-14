/**
 * Input analysis: URL detection, inline calculator, !bang site searches,
 * plus small formatting helpers shared by the UI.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  // -------------------------------------------------------------------------
  // Bangs
  // -------------------------------------------------------------------------

  const BANGS = [
    { key: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s' },
    { key: 'ddg', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
    { key: 'b', name: 'Brave Search', url: 'https://search.brave.com/search?q=%s' },
    { key: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
    { key: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s&type=repositories' },
    { key: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
    { key: 'wd', name: 'Wikipedia (DE)', url: 'https://de.wikipedia.org/w/index.php?search=%s' },
    { key: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
    { key: 'so', name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s' },
    { key: 'mdn', name: 'MDN Web Docs', url: 'https://developer.mozilla.org/en-US/search?q=%s' },
    { key: 'npm', name: 'npm', url: 'https://www.npmjs.com/search?q=%s' },
    { key: 'crates', name: 'crates.io', url: 'https://crates.io/search?q=%s' },
    { key: 'hn', name: 'Hacker News', url: 'https://hn.algolia.com/?q=%s' },
    { key: 'm', name: 'OpenStreetMap', url: 'https://www.openstreetmap.org/search?query=%s' },
    { key: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s' },
    { key: 'dl', name: 'DeepL', url: 'https://www.deepl.com/translator#auto/en/%s' },
  ];
  const BANG_MAP = new Map(BANGS.map((b) => [b.key, b]));

  function bangUrl(bang, query) {
    return bang.url.replace('%s', encodeURIComponent(query));
  }

  /**
   * "!yt lofi" / "lofi !yt"  -> { kind:'search', bang, query }
   * "!y" (no space yet)      -> { kind:'partial', typed:'y', matches:[...] }
   */
  function parseBang(input) {
    const text = input.trim();
    if (!text.includes('!')) return null;

    const partial = /^!(\S*)$/.exec(text);
    if (partial) {
      const typed = partial[1].toLowerCase();
      const exact = BANG_MAP.get(typed);
      const matches = BANGS.filter((b) => b.key.startsWith(typed) || b.name.toLowerCase().startsWith(typed));
      if (exact) matches.sort((a, b) => (b === exact) - (a === exact));
      return { kind: 'partial', typed, matches };
    }

    const tokens = text.split(/\s+/);
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.length < 2 || t[0] !== '!') continue;
      const bang = BANG_MAP.get(t.slice(1).toLowerCase());
      if (!bang) continue;
      const query = [...tokens.slice(0, i), ...tokens.slice(i + 1)].join(' ').trim();
      if (!query) return { kind: 'partial', typed: bang.key, matches: [bang] };
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
      'zone wiki news live email design studio space works today run sh lol ninja rocks ' +
      'rs gl ms vc im ee lt lv si hr ws nu pw sk ie il ir id th vn my ph pk ng ke eg ma ' +
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
    if (/^(about|chrome|helium):[\w/-]+$/i.test(text)) return text.replace(/^helium:(?!\/\/)/i, 'chrome://');

    // localhost / IPv4 with optional port & path
    if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d{1,5})?([/?#]\S*)?$/i.test(text)) return `http://${text}`;

    // domain.tld[:port][/path]
    const m = /^((?:[a-z0-9\p{L}](?:[a-z0-9\p{L}-]*[a-z0-9\p{L}])?\.)+)([a-z\p{L}]{2,})(:\d{1,5})?([/?#]\S*)?$/iu.exec(text);
    if (m && TLDS.has(m[2].toLowerCase())) return `https://${text}`;

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

  /** @returns {{expr:string, value:number, display:string}|null} */
  function calculate(input) {
    const text = input.trim().replace(/=$/, '').trim();
    if (!text || !/\d|pi|tau/i.test(text)) return null;
    // Needs an operator or a function call — a bare number is not a calculation.
    if (!/[+\-*/%^×÷()]/.test(text.replace(/^[-+]/, ''))) return null;
    if (/^[\d.]+$/.test(text)) return null;
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

  Z.parse = { BANGS, parseBang, bangUrl, detectUrl, calculate, evaluate, displayUrl, relativeTime };
})();
