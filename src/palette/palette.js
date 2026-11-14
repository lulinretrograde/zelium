/**
 * The palette UI. Used in two places:
 *  - inside a shadow root injected into normal pages (content.js)
 *  - full-window inside the fallback popup for restricted pages (fallback.js)
 */
(() => {
  const Z = (globalThis.Zelium ??= {});
  const { fuzzy: F, parse: P, icons: I, commands: C } = Z;

  // macOS uses ⌘; Windows, Linux and ChromeOS use Ctrl.
  const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const REMOVE_KEYS = IS_MAC ? '⌘⌫' : 'Ctrl+⇧⌫';

  const MODES = {
    all: { prefix: '', label: '', placeholder: 'Search tabs, bookmarks, history or the web…' },
    tabs: { prefix: '@', label: 'Tabs', placeholder: 'Search open tabs…' },
    bookmarks: { prefix: '#', label: 'Bookmarks', placeholder: 'Search bookmarks…' },
    history: { prefix: '/', label: 'History', placeholder: 'Search history…' },
    commands: { prefix: '>', label: 'Commands', placeholder: 'Run a command…' },
  };
  const MODE_ORDER = ['all', 'tabs', 'bookmarks', 'history', 'commands'];
  const PREFIX_TO_MODE = { '@': 'tabs', '#': 'bookmarks', '/': 'history', '>': 'commands' };

  const EMPTY_SNAPSHOT = { current: null, windowCount: 1, tabs: [], bookmarks: [], history: [], closed: [] };

  const LIMITS = {
    all: { tabs: 6, bookmarks: 5, history: 8, commands: 3 },
    mode: 200,
    emptyRecent: 8,
    emptyClosed: 5,
  };

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  // Always create elements in the XHTML namespace: in XML documents (e.g. the
  // browser's XML viewer) plain createElement would make namespace-less nodes.
  const XHTML = 'http://www.w3.org/1999/xhtml';

  function h(tag, cls, text) {
    const el = document.createElementNS(XHTML, tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function faviconUrl(pageUrl) {
    const u = new URL(chrome.runtime.getURL('_favicon/'));
    u.searchParams.set('pageUrl', pageUrl);
    u.searchParams.set('size', '32');
    return u.toString();
  }

  /** Fill `el` with `text`, wrapping matched character positions in <mark>. */
  function highlight(el, text, positions) {
    if (!positions || positions.size === 0) {
      el.textContent = text;
      return el;
    }
    let buf = '';
    let marked = false;
    const flush = () => {
      if (!buf) return;
      el.append(marked ? h('mark', null, buf) : document.createTextNode(buf));
      buf = '';
    };
    for (let i = 0; i < text.length; i++) {
      const hit = positions.has(i);
      if (hit !== marked) {
        flush();
        marked = hit;
      }
      buf += text[i];
    }
    flush();
    return el;
  }

  function recencyBoost(ts) {
    if (!ts) return 0;
    const age = Date.now() - ts;
    if (age < 3600e3) return 3;
    if (age < 86400e3) return 1.5;
    if (age < 7 * 86400e3) return 0.5;
    return 0;
  }

  /** Minimum score for a result: rejects scattered, low-quality subsequence matches. */
  function minScoreFor(q, perChar) {
    return perChar * q.replace(/\s+/g, '').length;
  }

  function lastSegment(path) {
    if (!path) return '';
    const parts = path.split(' / ');
    return parts[parts.length - 1];
  }

  // -------------------------------------------------------------------------
  // Palette
  // -------------------------------------------------------------------------

  class Palette {
    /**
     * @param {object} o
     * @param {Node} o.root            where to mount (ShadowRoot or element)
     * @param {boolean} [o.embedded]   fill the container instead of floating
     * @param {number} [o.contextTabId] tab the palette acts on (fallback window)
     * @param {boolean} [o.fallback]   running in the fallback popup window
     * @param {() => void} [o.onClose]
     */
    constructor({ root, embedded = false, contextTabId, fallback = false, onClose }) {
      this.root = root;
      this.embedded = embedded;
      this.contextTabId = contextTabId;
      this.fallback = fallback;
      this.onClose = onClose;

      this.snapshot = EMPTY_SNAPSHOT;
      this.histExtra = [];
      this.mode = 'all';
      this.query = '';
      this.sections = [];
      this.rows = [];
      this.sel = 0;
      this.isOpen = false;
      this.lastPointer = null;

      this.build();
    }

    // ----- DOM ---------------------------------------------------------------

    build() {
      const wrap = h('div', `z-wrap${this.embedded ? ' z-embedded' : ''}`);

      if (!this.embedded) {
        const backdrop = h('div', 'z-backdrop');
        backdrop.addEventListener('mousedown', (e) => {
          e.preventDefault();
          this.close();
        });
        wrap.append(backdrop);
      }

      const panel = h('div', 'z-panel');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Zelium');

      const head = h('div', 'z-head');
      const searchIcon = h('span', 'z-head-icon');
      searchIcon.append(I.icon('search'));
      this.chip = h('span', 'z-chip');
      this.chip.title = 'Back to all (⌫)';
      this.chip.addEventListener('mousedown', (e) => {
        e.preventDefault();
        this.setMode('all');
      });
      this.input = h('input', 'z-input');
      Object.assign(this.input, { type: 'text', spellcheck: false, autocomplete: 'off' });
      this.input.setAttribute('role', 'combobox');
      this.input.setAttribute('aria-expanded', 'true');
      this.input.setAttribute('aria-controls', 'z-list');
      this.input.setAttribute('autocapitalize', 'off');
      this.count = h('span', 'z-count');
      head.append(searchIcon, this.chip, this.input, this.count);

      this.list = h('div', 'z-list');
      this.list.id = 'z-list';
      this.list.setAttribute('role', 'listbox');

      this.empty = h('div', 'z-empty', 'No matches');

      const foot = h('div', 'z-foot');
      this.footLeft = h('div', 'z-foot-left');
      this.footRight = h('div', 'z-foot-right');
      foot.append(this.footLeft, this.footRight);

      panel.append(head, this.list, this.empty, foot);
      wrap.append(panel);
      this.root.append(wrap);
      this.wrap = wrap;

      this.input.addEventListener('input', () => this.onInput());
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.list.addEventListener('mousedown', (e) => e.preventDefault());
      this.list.addEventListener('mousemove', (e) => this.onPointer(e));
      this.list.addEventListener('click', (e) => {
        const i = this.rowIndexFromEvent(e);
        if (i != null) this.activate(this.rows[i], this.dispositionFrom(e));
      });
      this.list.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return;
        const i = this.rowIndexFromEvent(e);
        if (i != null) this.activate(this.rows[i], 'newTab');
      });

      this.renderFootLeft();
    }

    renderFootLeft() {
      const frag = document.createDocumentFragment();
      const hints = [
        ['@', 'tabs', 'tabs'],
        ['#', 'bookmarks', 'bookmarks'],
        ['/', 'history', 'history'],
        ['>', 'commands', 'commands'],
        ['!', 'bangs', null],
      ];
      for (const [key, label, mode] of hints) {
        const hint = h('span', 'z-hint');
        if (mode && mode === this.mode) hint.classList.add('z-active');
        hint.append(h('kbd', null, key), document.createTextNode(label));
        frag.append(hint);
      }
      this.footLeft.replaceChildren(frag);
    }

    renderFootRight(override) {
      const frag = document.createDocumentFragment();
      if (override) {
        frag.append(h('span', 'z-flash', override));
        this.footRight.replaceChildren(frag);
        return;
      }
      const row = this.rows[this.sel];
      const keys = [];
      switch (row?.kind) {
        case 'tab':
          keys.push(['↵', 'switch'], ['⇧↵', 'window'], [REMOVE_KEYS, 'close tab']);
          break;
        case 'history':
          keys.push(['↵', 'open'], [`${MOD}↵`, 'new tab'], [REMOVE_KEYS, 'forget']);
          break;
        case 'bookmark':
        case 'url':
        case 'bangSearch':
          keys.push(['↵', 'open'], [`${MOD}↵`, 'new tab'], ['⇧↵', 'window']);
          break;
        case 'closed':
          keys.push(['↵', 'restore']);
          break;
        case 'search':
          keys.push(['↵', 'search'], [`${MOD}↵`, 'new tab']);
          break;
        case 'command':
          keys.push(['↵', 'run']);
          if (row.data.ai) keys.push(['tab', 'write message']);
          break;
        case 'ask':
          keys.push(['↵', 'send'], ['⇧↵', 'window']);
          break;
        case 'calc':
          keys.push(['↵', 'copy']);
          break;
        case 'bang':
          keys.push(['↵', 'pick']);
          break;
      }
      keys.push(['esc', 'close']);
      for (const [k, label] of keys) {
        const hint = h('span', 'z-hint');
        hint.append(h('kbd', null, k), document.createTextNode(label));
        frag.append(hint);
      }
      this.footRight.replaceChildren(frag);
    }

    // ----- lifecycle ---------------------------------------------------------

    async open() {
      this.isOpen = true;
      this.mode = 'all';
      this.query = '';
      this.input.value = '';
      this.histExtra = [];
      this.sel = 0;
      this.applyMode();
      // Render the previous snapshot immediately (if any), then refresh.
      this.update();
      this.focus();
      try {
        this.snapshot = await this.send('snapshot');
      } catch (err) {
        this.renderFootRight(`Error: ${err.message}`);
        return;
      }
      if (this.isOpen) this.update({ keepSel: true });
    }

    close() {
      if (!this.isOpen) return;
      this.isOpen = false;
      clearTimeout(this.historyTimer);
      this.onClose?.();
    }

    focus() {
      this.input.focus({ preventScroll: true });
      // Some pages grab focus back on the next frame.
      requestAnimationFrame(() => this.isOpen && this.input.focus({ preventScroll: true }));
    }

    async send(type, data = {}) {
      const res = await chrome.runtime.sendMessage({
        type: `zelium:${type}`,
        tabId: this.contextTabId,
        fallback: this.fallback,
        ...data,
      });
      if (!res?.ok) throw new Error(res?.error || 'No response from Zelium');
      return res.data;
    }

    // ----- modes & input -----------------------------------------------------

    setMode(mode) {
      if (this.mode === mode) return;
      this.mode = mode;
      this.applyMode();
      this.sel = 0;
      this.update();
      this.scheduleHistory();
      this.input.focus({ preventScroll: true });
    }

    applyMode() {
      const m = MODES[this.mode];
      this.chip.hidden = !m.label;
      this.chip.textContent = m.label;
      this.input.placeholder = m.placeholder;
      this.wrap.dataset.mode = this.mode;
      this.renderFootLeft();
    }

    onInput() {
      let value = this.input.value;
      if (this.mode === 'all' && PREFIX_TO_MODE[value[0]]) {
        const mode = PREFIX_TO_MODE[value[0]];
        value = value.slice(1);
        this.input.value = value;
        this.mode = mode;
        this.applyMode();
      }
      this.query = value;
      this.sel = 0;
      if (value.includes('!')) this.ensureBangs();
      this.update();
      this.scheduleHistory();
    }

    scheduleHistory() {
      clearTimeout(this.historyTimer);
      const q = this.query.trim();
      if (!q || !(this.mode === 'all' || this.mode === 'history')) return;
      this.historyTimer = setTimeout(async () => {
        try {
          const items = await this.send('history', { text: q });
          if (!this.isOpen || this.query.trim() !== q) return;
          this.histExtra = items;
          this.update({ keepSel: true });
        } catch {
          /* ignore */
        }
      }, 90);
    }

    dispositionFrom(e) {
      if (IS_MAC ? e.metaKey : e.ctrlKey) return 'newTab';
      if (e.shiftKey) return 'newWindow';
      return 'current';
    }

    onKey(e) {
      if (e.isComposing || e.keyCode === 229) return;
      const action = this.keyAction(e);
      if (!action) return;
      // Swallow the event first: actions may close the palette and detach it
      // from the page mid-dispatch, and the page must never see these keys.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      // Closing actions run after the event has finished dispatching.
      if (action.closes) setTimeout(action.run, 0);
      else action.run();
    }

    /** Map a key event to an action, or null if the input should handle it normally. */
    keyAction(e) {
      const mod = IS_MAC ? e.metaKey : e.ctrlKey;
      const key = e.key;
      const row = this.rows[this.sel];
      const act = (run, closes = false) => ({ run, closes });

      if (key === 'Escape') return act(() => this.close(), true);
      if (key === 'ArrowDown' || (e.ctrlKey && (key === 'n' || key === 'j'))) return act(() => this.move(1));
      if (key === 'ArrowUp' || (e.ctrlKey && (key === 'p' || key === 'k'))) return act(() => this.move(-1));
      if (key === 'PageDown') return act(() => this.move(8, false));
      if (key === 'PageUp') return act(() => this.move(-8, false));
      if (key === 'Enter') {
        const disposition = this.dispositionFrom(e);
        return act(() => row && this.activate(row, disposition), true);
      }
      if (key === 'Tab') {
        if (row?.kind === 'bang') return act(() => this.completeBang(row));
        if (row?.kind === 'command' && row.data.ai && !e.shiftKey) return act(() => this.completeAsk(row.data.ai));
        return act(() => this.cycleMode(e.shiftKey ? -1 : 1));
      }
      if (key === 'Backspace' && mod && (IS_MAC || e.shiftKey) && (row?.kind === 'tab' || row?.kind === 'history')) {
        return act(() => this.removeRow(row));
      }
      if (key === 'Backspace' && this.input.value === '' && this.mode !== 'all') return act(() => this.setMode('all'));
      if (mod && key.toLowerCase() === 'c' && this.input.selectionStart === this.input.selectionEnd && row?.url) {
        return act(() => this.copyText(row.url).then((ok) => this.renderFootRight(ok ? 'Copied URL' : 'Copy failed')));
      }
      return null;
    }

    cycleMode(dir) {
      const i = MODE_ORDER.indexOf(this.mode);
      this.setMode(MODE_ORDER[(i + dir + MODE_ORDER.length) % MODE_ORDER.length]);
    }

    /** Tab on "New Claude Chat" → "claude " so the message can be typed. */
    completeAsk(ai) {
      this.input.value = `${ai.aliases[0]} `;
      this.onInput();
    }

    completeBang(row) {
      this.input.value = `!${row.data.key} `;
      this.onInput();
    }

    // ----- selection ---------------------------------------------------------

    move(delta, wrap = true) {
      const n = this.rows.length;
      if (!n) return;
      let i = this.sel + delta;
      i = wrap ? (i + n) % n : Math.max(0, Math.min(n - 1, i));
      this.select(i, true);
    }

    select(i, scroll) {
      const n = this.rows.length;
      if (!n) {
        this.sel = 0;
        this.input.removeAttribute('aria-activedescendant');
        this.renderFootRight();
        return;
      }
      this.sel = Math.max(0, Math.min(n - 1, i));
      const prev = this.list.querySelector('.z-row.z-sel');
      if (prev) {
        prev.classList.remove('z-sel');
        prev.removeAttribute('aria-selected');
      }
      const el = this.list.querySelector(`.z-row[data-index="${this.sel}"]`);
      if (el) {
        el.classList.add('z-sel');
        el.setAttribute('aria-selected', 'true');
        this.input.setAttribute('aria-activedescendant', el.id);
        if (scroll) this.scrollIntoView(el);
      }
      this.renderFootRight();
    }

    scrollIntoView(el) {
      const list = this.list;
      if (this.sel === 0) {
        list.scrollTop = 0;
        return;
      }
      const top = el.offsetTop;
      const bottom = top + el.offsetHeight;
      // Keep the section header visible when selecting the first row of a section.
      const prev = el.previousElementSibling;
      const headerTop = prev?.classList.contains('z-section') ? prev.offsetTop : top;
      if (headerTop < list.scrollTop) list.scrollTop = headerTop;
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight + 4;
    }

    rowIndexFromEvent(e) {
      const el = e.target.closest?.('.z-row');
      return el ? Number(el.dataset.index) : null;
    }

    onPointer(e) {
      // Ignore synthetic mousemoves caused by scrolling under a still pointer.
      const p = `${e.screenX},${e.screenY}`;
      if (p === this.lastPointer) return;
      this.lastPointer = p;
      const i = this.rowIndexFromEvent(e);
      if (i != null && i !== this.sel) this.select(i, false);
    }

    // ----- results -----------------------------------------------------------

    update({ keepSel = false } = {}) {
      const prevKey = keepSel ? this.rows[this.sel]?.key : null;
      this.sections = this.compute().filter((s) => s.rows.length);
      this.rows = this.sections.flatMap((s) => s.rows);
      if (prevKey) {
        const idx = this.rows.findIndex((r) => r.key === prevKey);
        if (idx >= 0) this.sel = idx;
      }
      this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
      this.render();
    }

    compute() {
      const q = this.query.trim();
      switch (this.mode) {
        case 'tabs':
          return [{ title: q ? 'Tabs' : 'Open tabs', rows: this.tabRows(q, LIMITS.mode) }];
        case 'bookmarks':
          return [{ title: q ? 'Bookmarks' : 'Recently added', rows: this.bookmarkRows(q, LIMITS.mode) }];
        case 'history':
          return [{ title: q ? 'History' : 'Recently visited', rows: this.historyRows(q, LIMITS.mode) }];
        case 'commands': {
          const ask = C.parseAsk(q);
          return [{ title: null, rows: [...(ask ? [this.askRow(ask)] : []), ...this.commandRows(q, LIMITS.mode)] }];
        }
        default:
          return this.computeAll(q);
      }
    }

    computeAll(q) {
      const snap = this.snapshot;
      const currentId = snap.current?.id;

      if (!q) {
        const recent = snap.tabs
          .filter((t) => t.id !== currentId)
          .sort((a, b) => b.lastAccessed - a.lastAccessed)
          .slice(0, LIMITS.emptyRecent)
          .map((t) => this.tabRow(t));
        const closed = snap.closed.slice(0, LIMITS.emptyClosed).map((c) => this.closedRow(c));
        return [
          { title: 'Recent tabs', rows: recent },
          { title: 'Recently closed', rows: closed },
        ];
      }

      // Raw query: a trailing space after "!w" means "open the site".
      const bang = P.parseBang(this.query);
      if (bang?.kind === 'partial' && bang.matches.length) {
        return [{ title: P.hasFullBangs() ? 'Bangs' : 'Bangs (loading full list…)', rows: bang.matches.map((b) => this.bangRow(b)) }];
      }
      if (bang?.kind === 'search' || bang?.kind === 'home') {
        const b = bang.bang;
        const home = bang.kind === 'home';
        return [
          {
            title: 'Bang',
            rows: [
              {
                key: `bangSearch:${b.key}:${bang.kind}`,
                kind: 'bangSearch',
                icon: 'bang',
                fav: P.bangHome(b),
                title: home ? `Open ${b.name}` : `Search ${b.name} for “${bang.query}”`,
                sub: P.displayUrl(bang.url),
                meta: `!${b.key}${b.ai ? ' · AI' : ''}`,
                url: bang.url,
              },
            ],
          },
        ];
      }

      const top = [];
      const ask = C.parseAsk(q);
      if (ask) top.push(this.askRow(ask));
      const calc = P.calculate(q);
      if (calc) {
        top.push({ key: 'calc', kind: 'calc', icon: 'calc', title: `= ${calc.display}`, sub: calc.expr, meta: 'calculator', data: calc });
      }
      const url = P.detectUrl(q);
      if (url) {
        top.push({ key: `url:${url}`, kind: 'url', icon: 'link', title: P.displayUrl(url) || url, sub: url, meta: 'open', url });
      }

      const tabs = this.tabRows(q, LIMITS.all.tabs);
      const bookmarks = this.bookmarkRows(q, LIMITS.all.bookmarks);
      const seen = new Set([...tabs, ...bookmarks].map((r) => r.url));
      const history = this.historyRows(q, LIMITS.all.history, seen);
      const minScore = minScoreFor(q, 7);
      const commands = this.commandRows(q, LIMITS.all.commands, minScore);
      const search = {
        key: 'search',
        kind: 'search',
        icon: 'search',
        title: `Search the web for “${q}”`,
        sub: '',
        meta: 'default engine',
      };

      return [
        { title: null, rows: top },
        { title: 'Tabs', rows: tabs },
        { title: 'Bookmarks', rows: bookmarks },
        { title: 'History', rows: history },
        { title: 'Commands', rows: commands },
        { title: 'Web', rows: [search] },
      ];
    }

    /** Mixed "all" results need tighter matches than a dedicated mode. */
    strictness() {
      return this.mode === 'all' ? 4.5 : 2.5;
    }

    tabRow(t, hl) {
      const snap = this.snapshot;
      const meta = [];
      if (t.id === snap.current?.id) meta.push('current');
      else if (snap.windowCount > 1 && snap.current && t.windowId !== snap.current.windowId) meta.push('other window');
      if (t.pinned) meta.push('pinned');
      if (t.muted) meta.push('muted');
      else if (t.audible) meta.push('playing');
      return {
        key: `tab:${t.id}`,
        kind: 'tab',
        fav: t.url,
        title: t.title,
        titleHl: hl?.[0],
        sub: P.displayUrl(t.url),
        subHl: hl?.[1],
        meta: meta.join(' · '),
        url: t.url,
        data: t,
      };
    }

    tabRows(q, limit) {
      const tabs = this.snapshot.tabs;
      if (!q) {
        return [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed).slice(0, limit).map((t) => this.tabRow(t));
      }
      return F.rank(q, tabs, (t) => [t.title, P.displayUrl(t.url)], {
        weights: [1, 0.85],
        limit,
        minScore: minScoreFor(q, this.strictness()),
        boost: (t) => recencyBoost(t.lastAccessed),
      }).map((r) => this.tabRow(r.item, r.hl));
    }

    bookmarkRow(b, hl) {
      return {
        key: `bookmark:${b.id}`,
        kind: 'bookmark',
        fav: b.url,
        title: b.title,
        titleHl: hl?.[0],
        sub: P.displayUrl(b.url),
        subHl: hl?.[1],
        meta: lastSegment(b.folder),
        url: b.url,
        data: b,
      };
    }

    bookmarkRows(q, limit) {
      const bms = this.snapshot.bookmarks;
      if (!q) {
        return [...bms].sort((a, b) => b.dateAdded - a.dateAdded).slice(0, limit).map((b) => this.bookmarkRow(b));
      }
      return F.rank(q, bms, (b) => [b.title, P.displayUrl(b.url), b.folder], {
        weights: [1, 0.8, 0.5],
        limit,
        minScore: minScoreFor(q, this.strictness()),
      }).map((r) => this.bookmarkRow(r.item, r.hl));
    }

    historyRow(item, hl) {
      return {
        key: `history:${item.url}`,
        kind: 'history',
        fav: item.url,
        title: item.title,
        titleHl: hl?.[0],
        sub: P.displayUrl(item.url),
        subHl: hl?.[1],
        meta: P.relativeTime(item.lastVisitTime),
        url: item.url,
        data: item,
      };
    }

    historyPool() {
      const seen = new Set();
      const out = [];
      for (const item of [...this.histExtra, ...this.snapshot.history]) {
        if (!item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        out.push(item);
      }
      return out;
    }

    historyRows(q, limit, exclude) {
      let pool = this.historyPool();
      if (exclude) pool = pool.filter((i) => !exclude.has(i.url));
      if (!q) {
        return pool.sort((a, b) => b.lastVisitTime - a.lastVisitTime).slice(0, limit).map((i) => this.historyRow(i));
      }
      return F.rank(q, pool, (i) => [i.title, P.displayUrl(i.url)], {
        weights: [1, 0.85],
        limit,
        minScore: minScoreFor(q, this.strictness()),
        boost: (i) => Math.log2(1 + i.visitCount) * 0.8 + recencyBoost(i.lastVisitTime),
      }).map((r) => this.historyRow(r.item, r.hl));
    }

    closedRow(c) {
      return {
        key: `closed:${c.sessionId}`,
        kind: 'closed',
        fav: c.isWindow ? null : c.url,
        icon: c.isWindow ? 'window' : 'restore',
        title: c.title,
        sub: c.isWindow ? '' : P.displayUrl(c.url),
        meta: P.relativeTime(c.lastModified),
        data: c,
      };
    }

    commandRow(cmd, hl) {
      return {
        key: `command:${cmd.id}`,
        kind: 'command',
        icon: cmd.icon,
        fav: cmd.url,
        title: cmd.title,
        titleHl: hl?.[0],
        meta: cmd.group,
        data: cmd,
      };
    }

    askRow({ ai, text }) {
      return {
        key: `ask:${ai.id}`,
        kind: 'ask',
        icon: 'sparkle',
        fav: ai.url,
        title: `Ask ${ai.name}: ${text}`,
        sub: 'sends the message in a new chat',
        meta: 'AI',
        data: { ai, text },
      };
    }

    commandRows(q, limit, minScore) {
      const cmds = C.list(this.snapshot.current);
      if (!q) return cmds.slice(0, limit).map((c) => this.commandRow(c));
      return F.rank(q, cmds, (c) => [c.title, c.keywords, c.group], {
        weights: [1, 0.6, 0.4],
        limit,
        minScore: minScore ?? minScoreFor(q, 4),
      }).map((r) => this.commandRow(r.item, r.hl));
    }

    bangRow(b) {
      return {
        key: `bang:${b.key}`,
        kind: 'bang',
        fav: P.bangHome(b),
        title: `!${b.key}`,
        sub: b.name,
        meta: `${b.host}${b.ai ? ' · AI' : ''}`,
        data: b,
      };
    }

    /**
     * Load the full bang list (~10k sites, same as Helium's) the first time
     * the user types "!". Until it arrives, a built-in set of popular bangs works.
     */
    ensureBangs() {
      if (P.hasFullBangs() || this.bangsLoading) return;
      this.bangsLoading = fetch(chrome.runtime.getURL('third_party/bangs/bangs.json'))
        .then((r) => r.json())
        .then((rows) => {
          P.setBangs(rows);
          if (this.isOpen) this.update({ keepSel: true });
        })
        .catch((err) => {
          console.warn('[Zelium] could not load bangs', err);
          this.bangsLoading = null;
        });
    }

    // ----- rendering ---------------------------------------------------------

    render() {
      const frag = document.createDocumentFragment();
      let i = 0;
      for (const section of this.sections) {
        if (section.title) frag.append(h('div', 'z-section', section.title));
        for (const row of section.rows) frag.append(this.renderRow(row, i++));
      }
      this.list.replaceChildren(frag);
      const hasRows = this.rows.length > 0;
      this.list.hidden = !hasRows;
      this.empty.hidden = hasRows;
      this.count.textContent = this.mode !== 'all' && hasRows ? String(this.rows.length) : '';
      this.select(this.sel, true);
    }

    renderRow(row, i) {
      const el = h('div', `z-row z-kind-${row.kind}`);
      el.dataset.index = String(i);
      el.id = `z-row-${i}`;
      el.setAttribute('role', 'option');

      const icon = h('span', 'z-icon');
      if (row.fav && /^(https?|ftp|file|chrome):/i.test(row.fav)) {
        const img = h('img');
        img.alt = '';
        img.width = 16;
        img.height = 16;
        img.decoding = 'async';
        // _favicon needs Chromium 104+; older builds/forks get a vector icon.
        img.addEventListener('error', () => img.replaceWith(I.icon(row.icon || 'globe')), { once: true });
        img.src = faviconUrl(row.fav);
        icon.append(img);
      } else {
        icon.append(I.icon(row.icon || 'globe'));
      }
      el.append(icon);
      el.append(highlight(h('span', 'z-title'), row.title || '', row.titleHl));
      if (row.sub) el.append(highlight(h('span', 'z-sub'), row.sub, row.subHl));
      if (row.meta) el.append(h('span', 'z-meta', row.meta));
      return el;
    }

    // ----- actions -----------------------------------------------------------

    async activate(row, disposition = 'current') {
      if (!row) return;
      switch (row.kind) {
        case 'bang':
          this.completeBang(row);
          return;
        case 'calc':
          await this.copyAndClose(row.data.display, `Copied ${row.data.display}`);
          return;
        case 'ask':
          return this.dispatch('aiChat', {
            url: row.data.ai.url,
            text: row.data.text,
            disposition: disposition === 'current' ? 'newTab' : disposition,
          });
        case 'command':
          if (row.data.url) {
            return this.dispatch('open', { url: row.data.url, disposition: disposition === 'current' ? 'newTab' : disposition });
          }
          if (row.data.local) {
            await this.runLocalCommand(row.data.id);
            return;
          }
          return this.dispatch('command', { id: row.data.id });
        case 'tab':
          if (disposition === 'newWindow') return this.dispatch('moveToWindow', { id: row.data.id });
          return this.dispatch('switchTab', { id: row.data.id });
        case 'closed':
          return this.dispatch('restore', { sessionId: row.data.sessionId });
        case 'search':
          return this.dispatch('search', { text: this.query.trim(), disposition });
        case 'bookmark':
        case 'history':
        case 'url':
        case 'bangSearch':
          return this.dispatch('open', { url: row.url, disposition });
      }
    }

    /** Send an action to the background and close the palette. */
    async dispatch(type, data) {
      const pending = this.send(type, data);
      if (!this.fallback) this.close();
      try {
        await pending;
      } catch (err) {
        if (this.fallback && this.isOpen) this.renderFootRight(`Error: ${err.message}`);
        else console.warn('[Zelium]', err);
        return;
      }
      if (this.fallback) this.close();
    }

    async runLocalCommand(id) {
      const tab = this.snapshot.current;
      const url = tab?.url ?? location.href;
      const title = tab?.title ?? document.title;
      if (id === 'copy.url') return this.copyAndClose(url, 'Copied URL');
      if (id === 'copy.title') return this.copyAndClose(title, 'Copied title');
      if (id === 'copy.markdown') {
        const safeTitle = title.replace(/([[\]\\])/g, '\\$1');
        return this.copyAndClose(`[${safeTitle}](${url})`, 'Copied Markdown link');
      }
    }

    async copyAndClose(text, message) {
      const ok = await this.copyText(text);
      this.renderFootRight(ok ? message : 'Copy failed');
      if (ok) setTimeout(() => this.close(), 380);
    }

    async copyText(text) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        /* insecure context or not focused — fall back */
      }
      const ta = h('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      this.wrap.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      this.input.focus({ preventScroll: true });
      return ok;
    }

    async removeRow(row) {
      try {
        if (row.kind === 'tab') {
          await this.send('closeTab', { id: row.data.id });
          this.snapshot = { ...this.snapshot, tabs: this.snapshot.tabs.filter((t) => t.id !== row.data.id) };
          this.renderFootRight('Closed tab');
        } else if (row.kind === 'history') {
          await this.send('deleteHistory', { url: row.url });
          const keep = (i) => i.url !== row.url;
          this.snapshot = { ...this.snapshot, history: this.snapshot.history.filter(keep) };
          this.histExtra = this.histExtra.filter(keep);
          this.renderFootRight('Removed from history');
        }
      } catch (err) {
        this.renderFootRight(`Error: ${err.message}`);
        return;
      }
      // Keep the same index so the next item becomes selected.
      const sel = this.sel;
      this.update();
      this.select(sel, true);
      clearTimeout(this.flashTimer);
      this.flashTimer = setTimeout(() => this.isOpen && this.renderFootRight(), 900);
    }
  }

  Z.Palette = Palette;
})();
