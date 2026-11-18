/**
 * The palette UI. Used in two places:
 *  - inside a shadow root injected into normal pages (content.js)
 *  - full-window inside the fallback popup for restricted pages (fallback.js)
 */
(() => {
  const Z = (globalThis.Zelium ??= {});
  const { fuzzy: F, parse: P, icons: I, commands: C, learn: L, settings: S } = Z;

  // macOS uses ⌘; Windows, Linux and ChromeOS use Ctrl.
  const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const MOD = IS_MAC ? '⌘' : 'Ctrl+';
  const REMOVE_KEYS = IS_MAC ? '⌘⌫' : 'Ctrl+⇧⌫';
  const ACTIONS_KEYS = `${MOD}.`;
  // Row kinds that have an actions menu (⌘. / Ctrl+.).
  const HAS_ACTIONS = new Set(['tab', 'history', 'bookmark', 'closed', 'url', 'bangSearch']);

  const MODES = {
    all: { prefix: '', label: '', placeholder: 'Search tabs, bookmarks, history or the web…' },
    tabs: { prefix: '@', label: 'Tabs', placeholder: 'Search open tabs…' },
    bookmarks: { prefix: '#', label: 'Bookmarks', placeholder: 'Search bookmarks…' },
    history: { prefix: '/', label: 'History', placeholder: 'Search history…' },
    commands: { prefix: '>', label: 'Commands', placeholder: 'Run a command…' },
  };
  const MODE_ORDER = ['all', 'tabs', 'bookmarks', 'history', 'commands'];
  const PREFIX_TO_MODE = { '@': 'tabs', '#': 'bookmarks', '/': 'history', '>': 'commands' };

  const EMPTY_SNAPSHOT = { current: null, windowCount: 1, tabs: [], bookmarks: [], folders: [], history: [], closed: [] };

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

  const isBookmarklet = (url) => /^s*javascript:/i.test(url || '');

  /** How long an action may take before the palette closes without waiting for it. */
  const QUICK_RESULT_MS = 400;

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
      this.settings = S.normalize(null);
      this.picks = {};
      this.learned = new Map();

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
        if (this.view) this.popView();
        else this.setMode('all');
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

      this.input.addEventListener('input', (e) => this.onInput(e));
      this.input.addEventListener('keydown', (e) => this.onKey(e));
      this.list.addEventListener('mousedown', (e) => e.preventDefault());
      this.list.addEventListener('mousemove', (e) => this.onPointer(e));
      this.list.addEventListener('click', (e) => {
        const i = this.rowIndexFromEvent(e);
        if (i != null) this.activate(this.rows[i], this.dispositionFrom(e));
      });
      this.list.addEventListener('contextmenu', (e) => {
        const i = this.rowIndexFromEvent(e);
        if (i == null) return;
        e.preventDefault();
        this.select(i, false);
        this.openActions(this.rows[i]);
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
        case 'action':
          keys.push(['↵', 'select']);
          break;
      }
      if (HAS_ACTIONS.has(row?.kind)) keys.push([ACTIONS_KEYS, 'actions']);
      keys.push(['esc', this.view ? 'back' : 'close']);
      for (const [k, label] of keys) {
        const hint = h('span', 'z-hint');
        hint.append(h('kbd', null, k), document.createTextNode(label));
        frag.append(hint);
      }
      this.footRight.replaceChildren(frag);
    }

    // ----- lifecycle ---------------------------------------------------------

    /** @param {{selection?: string}} [o] text selected on the page (overlay only) */
    async open({ selection = '' } = {}) {
      clearTimeout(this.closeTimer);
      this.isOpen = true;
      this.view = null;
      this.pageSelection = selection;
      this.askPage = null; // AI id while writing an "Ask … About This Page" message
      this.mode = 'all';
      this.query = '';
      this.input.value = '';
      this.histExtra = [];
      this.sel = 0;
      this.applyMode();
      // Render the previous snapshot immediately (if any), then refresh.
      this.update();
      this.focus();
      // Settings and learned picks are local and quick; re-rank once they're in.
      this.prefsReady = Promise.all([S.load(), L.load()]).then(([settings, picks]) => {
        this.settings = settings;
        this.picks = picks;
        if (this.isOpen) this.update({ keepSel: true });
      });
      this.snapshotReady = this.send('snapshot');
      try {
        this.snapshot = await this.snapshotReady;
      } catch (err) {
        this.renderFootRight(`Error: ${err.message}`);
        return;
      }
      if (this.isOpen) this.update({ keepSel: true });
    }

    close() {
      clearTimeout(this.closeTimer);
      if (!this.isOpen) return;
      this.isOpen = false;
      clearTimeout(this.historyTimer);
      this.onClose?.();
    }

    /** Close after a confirmation has been readable for a moment; cancelled if the palette closes or reopens first. */
    closeSoon() {
      clearTimeout(this.closeTimer);
      this.closeTimer = setTimeout(() => this.close(), 380);
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
      const m = this.view ? { label: this.view.title, placeholder: this.view.placeholder || 'Filter…' } : MODES[this.mode];
      this.chip.hidden = !m.label;
      this.chip.textContent = m.label;
      this.input.placeholder = m.placeholder;
      this.wrap.dataset.mode = this.view ? 'view' : this.mode;
      this.renderFootLeft();
    }

    // ----- sub-views (pickers, the actions menu) -----------------------------

    /**
     * Show a list of choices in place of the results. Esc (or ⌫ on an empty
     * input) goes back to where you were.
     * @param {{title:string, placeholder?:string, items:{id:string, title:string, sub?:string, meta?:string,
     *          icon?:string, fav?:string, keywords?:string, run:(disposition:string)=>any}[]}} view
     */
    pushView(view) {
      view.prev = { view: this.view, mode: this.mode, value: this.input.value, query: this.query, sel: this.sel };
      this.view = view;
      this.input.value = '';
      this.query = '';
      this.sel = 0;
      this.applyMode();
      this.update();
      this.input.focus({ preventScroll: true });
    }

    popView() {
      const prev = this.view?.prev;
      if (!prev) return;
      this.view = prev.view;
      this.mode = prev.mode;
      this.input.value = prev.value;
      this.query = prev.query;
      this.sel = prev.sel;
      this.applyMode();
      this.update();
      this.input.focus({ preventScroll: true });
    }

    viewRows(q) {
      const toRow = (item, hl) => ({
        key: `action:${item.id}`,
        kind: 'action',
        icon: item.icon,
        fav: item.fav,
        title: item.title,
        titleHl: hl?.[0],
        sub: item.sub,
        subHl: hl?.[1],
        meta: item.meta,
        data: item,
      });
      const items = this.view.items;
      if (!q) return items.map((i) => toRow(i));
      return F.rank(q, items, (i) => [i.title, i.sub || '', i.keywords || ''], {
        weights: [1, 0.6, 0.4],
        minScore: minScoreFor(q, 2.5),
      }).map((r) => toRow(r.item, r.hl));
    }

    onInput(e) {
      let value = this.input.value;
      // A prefix typed into the empty box switches modes; pasted or dropped
      // text ("/r/rust", "#tag", "@user") is a query, also as you keep typing.
      const pasted = e?.inputType === 'insertFromPaste' || e?.inputType === 'insertFromDrop';
      if (!this.view && this.mode === 'all' && this.query === '' && PREFIX_TO_MODE[value[0]] && !pasted) {
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
      if (!q || this.view || !(this.mode === 'all' || this.mode === 'history')) return;
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

      if (key === 'Escape') return this.view ? act(() => this.popView()) : act(() => this.close(), true);
      if (key === 'ArrowDown' || (e.ctrlKey && (key === 'n' || key === 'j'))) return act(() => this.move(1));
      if (key === 'ArrowUp' || (e.ctrlKey && (key === 'p' || key === 'k'))) return act(() => this.move(-1));
      if (key === 'PageDown') return act(() => this.move(8, false));
      if (key === 'PageUp') return act(() => this.move(-8, false));
      if (key === 'Enter') {
        const disposition = this.dispositionFrom(e);
        return act(() => row && this.activate(row, disposition), true);
      }
      if (key === 'Tab') {
        if (this.view) return act(() => {});
        if (row?.kind === 'bang') return act(() => this.completeBang(row));
        if (row?.kind === 'command' && row.data.ai && !e.shiftKey) return act(() => this.completeAsk(row.data.ai, !!row.data.aiPage));
        return act(() => this.cycleMode(e.shiftKey ? -1 : 1));
      }
      if (mod && key === '.' && !this.view) return act(() => this.openActions(row));
      if (key === 'Backspace' && mod && (IS_MAC || e.shiftKey) && (row?.kind === 'tab' || row?.kind === 'history')) {
        return act(() => this.removeRow(row));
      }
      if (key === 'Backspace' && this.input.value === '' && this.view) return act(() => this.popView());
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

    /**
     * Tab on "New Claude Chat" → "claude " (">" mode) or "claude: " (main search)
     * to type the message. On "Ask Claude About This Page" the message is about the page.
     */
    completeAsk(ai, page = false) {
      this.askPage = page ? ai.id : null;
      this.input.value = this.mode === 'all' ? `${ai.aliases[0]}: ` : `${ai.aliases[0]} `;
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
      if (this.view) return [{ title: null, rows: this.viewRows(q) }];
      this.learned = this.settings.learn ? L.boosts(this.picks, q) : new Map();
      switch (this.mode) {
        case 'tabs':
          return [{ title: q ? 'Tabs' : 'Open tabs', rows: this.tabRows(q, LIMITS.mode) }];
        case 'bookmarks':
          return [{ title: q ? 'Bookmarks' : 'Recently added', rows: this.bookmarkRows(q, LIMITS.mode) }];
        case 'history':
          return [{ title: q ? 'History' : 'Recently visited', rows: this.historyRows(q, LIMITS.mode) }];
        case 'commands': {
          const ask = this.askFor(q, false);
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
      // Mixed results: only an explicit "claude: …" asks, so "claude code docs" still searches.
      const ask = this.askFor(q, true);
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
      const hit = this.takeTopHit([tabs, bookmarks, history, commands]);
      if (hit) top.push(hit);
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

    /** Learned boost for a row's item (0 if never picked for this query). */
    learnedFor(key) {
      return this.learned.get(key) ?? 0;
    }

    /** Move the result you usually pick for this query to the top, out of its section. */
    takeTopHit(lists) {
      let best = null;
      for (const list of lists) {
        for (let i = 0; i < list.length; i++) {
          const b = this.learnedFor(L.keyFor(list[i]));
          if (b >= L.TOP_HIT && (!best || b > best.b)) best = { list, i, b };
        }
      }
      return best ? best.list.splice(best.i, 1)[0] : null;
    }

    /** Remember what was picked for the current query. */
    learnPick(row) {
      if (!this.settings.learn || this.view || this.snapshot.current?.incognito) return;
      const key = L.keyFor(row);
      if (!key || !this.query.trim()) return;
      this.picks = L.record(this.picks, this.query, key);
      L.save(this.picks).catch(() => {});
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
        boost: (t) => recencyBoost(t.lastAccessed) + this.learnedFor(`url:${t.url}`),
      }).map((r) => this.tabRow(r.item, r.hl));
    }

    bookmarkRow(b, hl) {
      const bookmarklet = isBookmarklet(b.url);
      return {
        key: `bookmark:${b.id}`,
        kind: 'bookmark',
        fav: bookmarklet ? null : b.url,
        icon: bookmarklet ? 'command' : undefined,
        title: b.title,
        titleHl: hl?.[0],
        sub: bookmarklet ? 'bookmarklet' : P.displayUrl(b.url),
        subHl: bookmarklet ? undefined : hl?.[1],
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
        boost: (b) => this.learnedFor(`url:${b.url}`),
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
        boost: (i) => Math.log2(1 + i.visitCount) * 0.8 + recencyBoost(i.lastVisitTime) + this.learnedFor(`url:${i.url}`),
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

    /** An "ask an AI" row for the query, if it is one; about the page after Tab on "Ask … About This Page". */
    askFor(q, requireColon) {
      let ask = C.parseAsk(q, { requireColon });
      if (!ask && this.askPage) {
        const ai = C.parseAskAlias(q);
        if (ai) ask = { ai, text: '' };
      }
      if (ask && ask.ai.id === this.askPage) ask.page = true;
      return ask;
    }

    askRow({ ai, text, page = false }) {
      if (page) {
        const sel = this.pageSelection?.trim();
        return {
          key: `ask:${ai.id}:page`,
          kind: 'ask',
          icon: 'sparkle',
          fav: ai.url,
          title: `Ask ${ai.name} about this page: ${text || this.settings.pagePrompt}`,
          sub: `sends it with the page title and URL${sel ? ' and your selection' : ''}`,
          meta: 'AI',
          data: { ai, text, page },
        };
      }
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

    /** Open a new chat and send `text` (or the default prompt) with the page's title, URL and selection. */
    async askAboutPage(ai, text, disposition) {
      const fresh = await this.snapshotReady?.catch(() => null);
      const tab = fresh?.current ?? this.snapshot.current;
      if (!tab) {
        this.renderFootRight('Error: no current tab');
        return;
      }
      const message = C.pageMessage(text || this.settings.pagePrompt, { title: tab.title, url: tab.url, selection: this.pageSelection });
      return this.dispatch('aiChat', { url: ai.url, text: message, disposition: disposition === 'current' ? 'newTab' : disposition });
    }

    commandRows(q, limit, minScore) {
      const cmds = C.list(this.snapshot.current);
      if (!q) return cmds.slice(0, limit).map((c) => this.commandRow(c));
      return F.rank(q, cmds, (c) => [c.title, c.keywords, c.group], {
        weights: [1, 0.6, 0.4],
        limit,
        minScore: minScore ?? minScoreFor(q, 4),
        boost: (c) => this.learnedFor(`command:${c.id}`),
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
      this.learnPick(row);
      switch (row.kind) {
        case 'action':
          return row.data.run(disposition);
        case 'bang':
          this.completeBang(row);
          return;
        case 'calc':
          await this.copyAndClose(row.data.display, `Copied ${row.data.display}`);
          return;
        case 'ask':
          if (row.data.page) return this.askAboutPage(row.data.ai, row.data.text, disposition);
          return this.dispatch('aiChat', {
            url: row.data.ai.url,
            text: row.data.text,
            disposition: disposition === 'current' ? 'newTab' : disposition,
          });
        case 'command':
          if (row.data.aiPage) return this.askAboutPage(row.data.ai, '', disposition);
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
          if (isBookmarklet(row.url)) {
            this.renderFootRight("Bookmarklets can't run from Zelium: use the bookmarks bar");
            return;
          }
          return this.dispatch('open', { url: row.url, disposition });
        case 'history':
        case 'url':
        case 'bangSearch':
          return this.dispatch('open', { url: row.url, disposition });
      }
    }

    /**
     * Send an action to the background and close the palette. Most actions
     * answer within a few ms, so wait briefly and keep the palette open with
     * the error if one fails; slow ones (an AI chat typing its message) close
     * right away. The fallback window waits for the whole action.
     */
    async dispatch(type, data, { done } = {}) {
      const pending = this.send(type, data).then(
        () => null,
        (err) => err,
      );
      const err = this.fallback
        ? await pending
        : await Promise.race([pending, new Promise((r) => setTimeout(() => r(null), QUICK_RESULT_MS))]);
      if (err) {
        if (this.isOpen) this.renderFootRight(`Error: ${err.message}`);
        else console.warn('[Zelium]', err);
        return;
      }
      if (done && this.isOpen) {
        // Say what happened before closing (for actions with no visible effect).
        this.renderFootRight(done);
        this.closeSoon();
      } else {
        this.close();
      }
      if (!this.fallback) pending.then((late) => late && console.warn('[Zelium]', late));
    }

    async runLocalCommand(id) {
      // The palette runs in an extension page, so only the snapshot knows the
      // tab. Use this open's fresh one (the frame outlives in-page navigation).
      const fresh = await this.snapshotReady?.catch(() => null);
      const tab = fresh?.current ?? this.snapshot.current;
      if (!tab) {
        this.renderFootRight('Error: no current tab');
        return;
      }
      const { url, title } = tab;
      if (id === 'learn.clear') {
        await L.clear();
        this.picks = {};
        this.renderFootRight('Cleared learned results');
        this.closeSoon();
        return;
      }
      if (id === 'copy.url') return this.copyAndClose(url, 'Copied URL');
      if (id === 'copy.title') return this.copyAndClose(title, 'Copied title');
      if (id === 'bookmark.toggle') {
        return tab.bookmarked
          ? this.dispatch('bookmarkRemove', { url }, { done: 'Removed bookmark' })
          : this.dispatch('bookmarkSet', { url, title }, { done: 'Bookmarked' });
      }
      if (id === 'bookmark.folder') return this.pickBookmarkFolder({ url, title }, tab.bookmarked);
      if (id === 'copy.markdown') return this.copyAndClose(P.markdownLink(title, url), 'Copied Markdown link');
      if (id === 'copy.windowUrls' || id === 'copy.windowMarkdown') {
        const tabs = (fresh ?? this.snapshot).tabs.filter((t) => t.windowId === tab.windowId).sort((a, b) => a.index - b.index);
        const format = id === 'copy.windowMarkdown' ? 'markdown' : 'urls';
        return this.copyAndClose(P.formatTabList(tabs, format), `Copied ${tabs.length} tab${tabs.length === 1 ? '' : 's'}`);
      }
    }

    // ----- actions menu --------------------------------------------------------

    /** The actions menu for a result row (⌘. / Ctrl+. or right-click). */
    openActions(row) {
      const items = row && HAS_ACTIONS.has(row.kind) ? this.actionsFor(row) : null;
      if (!items?.length) {
        this.renderFootRight('No actions for this row');
        return;
      }
      this.pushView({ title: 'Actions', placeholder: `Actions for ${row.title || row.url}`, items });
    }

    /** What can be done with a row, in the order shown. */
    actionsFor(row) {
      const a = (id, title, icon, run, meta) => ({ id, title, icon, run, meta });
      const url = row.url ?? row.data?.url;
      const title = row.data?.title ?? row.title;
      const isMark = row.kind === 'bookmark';
      const bookmarklet = isBookmarklet(url);
      const bookmarked = isMark || (url && this.snapshot.bookmarks.some((b) => b.url === url));
      const open = (disposition) => () => this.activate(row, disposition);
      const out = [];

      if (row.kind === 'tab') {
        const t = row.data;
        const cmd = (id, done) => () => this.dispatch('command', { id, targetTabId: t.id }, { done });
        out.push(
          a('switch', 'Switch to Tab', 'tab', open('current'), '↵'),
          a('window', 'Move to New Window', 'moveWindow', open('newWindow'), '⇧↵'),
          a('close', 'Close Tab', 'close', () => (this.popView(), this.removeRow(row)), REMOVE_KEYS),
          a('pin', t.pinned ? 'Unpin Tab' : 'Pin Tab', 'pin', cmd('tab.togglePin', t.pinned ? 'Unpinned' : 'Pinned')),
          a('mute', t.muted ? 'Unmute Tab' : 'Mute Tab', t.muted ? 'volume' : 'mute', cmd('tab.toggleMute', t.muted ? 'Unmuted' : 'Muted')),
          a('reload', 'Reload Tab', 'reload', cmd('tab.reload', 'Reloaded')),
          a('duplicate', 'Duplicate Tab', 'copy', cmd('tab.duplicate')),
        );
      } else if (row.kind === 'closed') {
        out.push(a('restore', 'Restore', 'restore', open('current'), '↵'));
      } else if (!bookmarklet) {
        out.push(
          a('open', 'Open', 'link', open('current'), '↵'),
          a('newTab', 'Open in New Tab', 'plus', open('newTab'), `${MOD}↵`),
          a('newWindow', 'Open in New Window', 'window', open('newWindow'), '⇧↵'),
        );
      }

      if (url && !(row.kind === 'closed' && row.data.isWindow)) {
        out.push(
          a('copyUrl', bookmarklet ? 'Copy Bookmarklet Code' : 'Copy URL', 'copy', () => this.copyAndClose(url, 'Copied')),
          a('copyMarkdown', 'Copy as Markdown Link', 'markdown', () => this.copyAndClose(P.markdownLink(title, url), 'Copied Markdown link')),
        );
      }

      if (isMark) {
        const b = row.data;
        out.push(
          a('move', 'Move Bookmark to Folder…', 'bookmark', () => this.pickBookmarkFolder({ url, title, id: b.id }, true)),
          a('unbookmark', 'Remove Bookmark', 'close', () => this.dispatch('bookmarkRemove', { id: b.id }, { done: 'Removed bookmark' })),
        );
      } else if (url && /^(https?|ftp|file):/i.test(url) && row.kind !== 'closed') {
        out.push(
          bookmarked
            ? a('unbookmark', 'Remove Bookmark', 'bookmark', () => this.dispatch('bookmarkRemove', { url }, { done: 'Removed bookmark' }))
            : a('bookmark', 'Bookmark', 'bookmark', () => this.dispatch('bookmarkSet', { url, title }, { done: 'Bookmarked' })),
          a('folder', bookmarked ? 'Move Bookmark to Folder…' : 'Bookmark in Folder…', 'bookmark', () =>
            this.pickBookmarkFolder({ url, title }, bookmarked),
          ),
        );
      }

      if (row.kind === 'history') {
        out.push(a('forget', 'Remove from History', 'close', () => (this.popView(), this.removeRow(row)), REMOVE_KEYS));
      }
      return out;
    }

    /** Folder picker: bookmark `page` there, or move its existing bookmark. */
    pickBookmarkFolder(page, bookmarked) {
      const folders = this.snapshot.folders;
      this.pushView({
        title: bookmarked ? 'Move to' : 'Bookmark in',
        placeholder: 'Pick a folder…',
        items: folders.map((f) => ({
          id: `folder:${f.id}`,
          icon: 'bookmark',
          title: f.title,
          sub: f.path,
          run: () =>
            this.dispatch('bookmarkSet', { ...page, parentId: f.id }, { done: `${bookmarked ? 'Moved' : 'Bookmarked'} in ${f.title}` }),
        })),
      });
    }

    async copyAndClose(text, message) {
      const ok = await this.copyText(text);
      this.renderFootRight(ok ? message : 'Copy failed');
      if (ok) this.closeSoon();
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
