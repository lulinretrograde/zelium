/**
 * Command definitions shown in ">" mode.
 *  - `local: true` commands run in the palette (clipboard); the rest are sent
 *    to the background worker by id.
 *  - `url` commands open that page (new tab by default; ⇧↵ new window).
 *  - `ai` commands also accept a message: Tab, type it, ↵ sends it.
 *  - `title` may be a function of the current tab for toggles.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  /**
   * AI chat services. Typing "<alias> <message>" (e.g. "claude what is MV3")
   * offers to send the message in a new chat; aliases are matched whole-word.
   */
  const AI = [
    { id: 'ai.claude', name: 'Claude', aliases: ['claude'], keywords: 'ai anthropic assistant llm', url: 'https://claude.ai/new' },
    { id: 'ai.chatgpt', name: 'ChatGPT', aliases: ['chatgpt', 'gpt', 'cgpt'], keywords: 'ai openai assistant llm', url: 'https://chatgpt.com/' },
    { id: 'ai.gemini', name: 'Gemini', aliases: ['gemini'], keywords: 'ai google bard assistant llm', url: 'https://gemini.google.com/app' },
    { id: 'ai.deepseek', name: 'DeepSeek', aliases: ['deepseek'], keywords: 'ai assistant llm', url: 'https://chat.deepseek.com/' },
    { id: 'ai.kimi', name: 'Kimi', aliases: ['kimi'], keywords: 'ai moonshot assistant llm', url: 'https://www.kimi.com/' },
  ];

  /**
   * Opt-in services from the settings (Perplexity, your own…). They take the
   * message in the URL (`template` with %s) instead of Zelium typing it.
   */
  let EXTRA = [];

  function setExtraAis(list) {
    EXTRA = (list || []).map((e) => {
      let home = e.url;
      try {
        home = new URL(e.url.replaceAll('%s', '')).origin + '/';
      } catch {
        /* keep the template */
      }
      return { id: `ai.x.${e.alias}`, name: e.name, aliases: [e.alias], keywords: 'ai assistant llm', url: home, template: e.url };
    });
  }

  /** Built-in services first, so they win alias clashes. */
  const allAis = () => [...AI, ...EXTRA];

  /** A service's URL with the message filled in (template services only). */
  const fillTemplate = (template, text) => template.replaceAll('%s', encodeURIComponent(text));

  /**
   * "claude how do bangs work" / "claude: how…" → { ai, text }; null unless an
   * alias + message. With `requireColon` (the main search), only "claude: …"
   * counts, so searches like "claude code docs" stay searches.
   */
  function parseAsk(query, { requireColon = false } = {}) {
    const m = /^\s*([a-z]+)(\s*:\s*|\s+)(\S[\s\S]*)$/i.exec(query);
    if (!m || (requireColon && !m[2].includes(':'))) return null;
    const alias = m[1].toLowerCase();
    const ai = allAis().find((a) => a.aliases.includes(alias));
    return ai ? { ai, text: m[3].trim() } : null;
  }

  function newChatCommand(a) {
    return { id: a.id, title: `New ${a.name} Chat`, keywords: `${a.keywords} ${a.aliases.join(' ')}`, icon: 'sparkle', url: a.url, ai: a, group: 'AI' };
  }

  function pageCommand(a) {
    return {
      id: `${a.id}.page`,
      title: `Ask ${a.name} About This Page`,
      keywords: `${a.keywords} ${a.aliases.join(' ')} summarize summary explain tldr current page site article`,
      icon: 'sparkle',
      url: a.url,
      ai: a,
      aiPage: true,
      group: 'AI',
    };
  }

  const COMMANDS = [
    { id: 'copy.url', title: 'Copy URL', keywords: 'link address clipboard', icon: 'copy', local: true, group: 'Copy' },
    { id: 'copy.markdown', title: 'Copy as Markdown Link', keywords: 'md link clipboard', icon: 'markdown', local: true, group: 'Copy' },
    { id: 'copy.title', title: 'Copy Page Title', keywords: 'name clipboard', icon: 'text', local: true, group: 'Copy' },
    { id: 'copy.windowUrls', title: 'Copy All Tab URLs in Window', keywords: 'links list clipboard every tabs', icon: 'copy', local: true, group: 'Copy' },
    { id: 'copy.windowMarkdown', title: 'Copy All Tabs as Markdown List', keywords: 'md links list clipboard every tabs', icon: 'markdown', local: true, group: 'Copy' },

    { id: 'tab.new', title: 'New Tab', keywords: 'open create', icon: 'plus', group: 'Tab' },
    { id: 'tab.close', title: 'Close Tab', keywords: 'remove kill', icon: 'close', group: 'Tab' },
    { id: 'tab.closeOthers', title: 'Close Other Tabs', keywords: 'remove only keep', icon: 'closeOthers', group: 'Tab' },
    { id: 'tab.closeRight', title: 'Close Tabs to the Right', keywords: 'remove', icon: 'closeRight', group: 'Tab' },
    { id: 'tab.closeDuplicates', title: 'Close Duplicate Tabs', keywords: 'dedupe dupes clean', icon: 'dupes', group: 'Tab' },
    { id: 'tab.duplicate', title: 'Duplicate Tab', keywords: 'clone copy', icon: 'copy', group: 'Tab' },
    { id: 'tab.togglePin', title: (t) => (t?.pinned ? 'Unpin Tab' : 'Pin Tab'), keywords: 'pin unpin', icon: 'pin', group: 'Tab' },
    { id: 'tab.toggleMute', title: (t) => (t?.muted ? 'Unmute Tab' : 'Mute Tab'), keywords: 'sound audio silence', icon: (t) => (t?.muted ? 'volume' : 'mute'), group: 'Tab' },
    { id: 'tab.reload', title: 'Reload Tab', keywords: 'refresh', icon: 'reload', group: 'Tab' },
    { id: 'tab.hardReload', title: 'Hard Reload Tab', keywords: 'refresh bypass cache', icon: 'reload', group: 'Tab' },
    { id: 'tab.toWindow', title: 'Move Tab to New Window', keywords: 'detach pop out', icon: 'moveWindow', group: 'Tab' },
    { id: 'tab.sortByDomain', title: 'Sort Tabs by Domain', keywords: 'organize order arrange', icon: 'sort', group: 'Tab' },
    { id: 'session.reopen', title: 'Reopen Closed Tab', keywords: 'undo restore', icon: 'restore', group: 'Tab' },

    { id: 'bookmark.toggle', title: (t) => (t?.bookmarked ? 'Remove Bookmark' : 'Bookmark Page'), keywords: 'favorite star save unbookmark delete', icon: 'bookmark', local: true, group: 'Bookmark' },
    { id: 'bookmark.folder', title: (t) => (t?.bookmarked ? 'Move Bookmark to Folder…' : 'Bookmark Page in Folder…'), keywords: 'favorite star save organize', icon: 'bookmark', local: true, group: 'Bookmark' },

    ...AI.map(newChatCommand),
    ...AI.map(pageCommand),

    { id: 'window.new', title: 'New Window', keywords: 'open', icon: 'window', group: 'Window' },
    { id: 'window.incognito', title: 'New Private Window', keywords: 'incognito inprivate private', icon: 'incognito', group: 'Window' },

    { id: 'zoom.in', title: 'Zoom In', keywords: 'bigger larger', icon: 'zoomIn', group: 'View' },
    { id: 'zoom.out', title: 'Zoom Out', keywords: 'smaller', icon: 'zoomOut', group: 'View' },
    { id: 'zoom.reset', title: 'Reset Zoom', keywords: 'actual size 100', icon: 'zoomReset', group: 'View' },

    { id: 'downloads.search', title: 'Search Downloads', keywords: 'files downloaded', icon: 'download', local: true, group: 'Downloads' },
    { id: 'downloads.openLatest', title: 'Open Latest Download', keywords: 'file last recent newest downloaded', icon: 'download', local: true, group: 'Downloads' },

    { id: 'page.history', title: 'Open History', keywords: 'chrome page', icon: 'history', group: 'Open' },
    { id: 'page.downloads', title: 'Open Downloads', keywords: 'chrome page files', icon: 'download', group: 'Open' },
    { id: 'page.bookmarks', title: 'Open Bookmark Manager', keywords: 'chrome page', icon: 'bookmark', group: 'Open' },
    { id: 'page.extensions', title: 'Open Extensions', keywords: 'chrome page addons plugins', icon: 'grid', group: 'Open' },
    { id: 'page.settings', title: 'Open Settings', keywords: 'chrome page preferences', icon: 'settings', group: 'Open' },
    { id: 'page.shortcuts', title: 'Change Zelium Shortcut', keywords: 'keyboard hotkey keybinding', icon: 'keyboard', group: 'Open' },

    { id: 'learn.clear', title: 'Clear Learned Results', keywords: 'forget reset ranking picks frecency', icon: 'close', local: true, group: 'Zelium' },
  ];

  /** "claude:" / "gpt" with no message yet → the service, else null. */
  function parseAskAlias(query) {
    const m = /^\s*([a-z]+)\s*:?\s*$/i.exec(query);
    return m ? (allAis().find((a) => a.aliases.includes(m[1].toLowerCase())) ?? null) : null;
  }

  const MAX_SELECTION = 4000;

  /** The message for "Ask … About This Page": your text, then the page and any selected text. */
  function pageMessage(text, { title, url, selection }) {
    const parts = [text.trim(), '', `Page: ${title && title !== url ? `${title}\n` : ''}${url}`];
    const sel = (selection || '').trim();
    if (sel) {
      const cut = sel.length > MAX_SELECTION ? `${sel.slice(0, MAX_SELECTION)}…` : sel;
      parts.push('', 'Selected text:', '"""', cut, '"""');
    }
    return parts.join('\n');
  }

  const resolve = (v, tab) => (typeof v === 'function' ? v(tab) : v);

  /** Commands with titles/icons resolved for the current tab. */
  function list(currentTab) {
    const all = [...COMMANDS, ...EXTRA.map(newChatCommand), ...EXTRA.map(pageCommand)];
    return all.map((c) => ({ ...c, title: resolve(c.title, currentTab), icon: resolve(c.icon, currentTab) }));
  }

  Z.commands = { AI, COMMANDS, list, parseAsk, parseAskAlias, pageMessage, MAX_SELECTION, setExtraAis, allAis, fillTemplate };
})();
