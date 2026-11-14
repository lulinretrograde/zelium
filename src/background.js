/**
 * Zelium background service worker.
 *
 * Responsibilities:
 *  - Open/close the palette when the shortcut (or toolbar button) is used.
 *    Normal pages get an in-page overlay (injected on demand via activeTab);
 *    pages extensions cannot script (chrome://, new tab, Web Store, PDFs...)
 *    get a small centred popup window with the same UI instead.
 *  - Serve data (tabs, bookmarks, history, recently closed) to the palette.
 *  - Perform actions (switch/open/close tabs, search, run commands).
 */

const PALETTE_FILES = [
  'palette/fuzzy.js',
  'palette/parse.js',
  'palette/icons.js',
  'palette/commands.js',
  'palette/palette.js',
  'content.js',
];

const RESTRICTED_SCHEMES =
  /^(chrome|chrome-extension|chrome-search|chrome-untrusted|devtools|edge|brave|helium|view-source|about|data|javascript|file):/i;
const RESTRICTED_HOSTS = ['chromewebstore.google.com', 'chrome.google.com'];

const HISTORY_SNAPSHOT_SIZE = 1000;
const HISTORY_QUERY_SIZE = 150;
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

// ---------------------------------------------------------------------------
// Opening the palette
// ---------------------------------------------------------------------------

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-palette') togglePalette(tab);
});

chrome.action.onClicked.addListener((tab) => togglePalette(tab));

chrome.windows.onRemoved.addListener(async (windowId) => {
  if ((await getFallbackWindowId()) === windowId) await setFallbackWindowId(null);
});

function isRestricted(url) {
  if (!url) return true;
  if (RESTRICTED_SCHEMES.test(url)) return true;
  try {
    const { hostname } = new URL(url);
    return RESTRICTED_HOSTS.includes(hostname);
  } catch {
    return true;
  }
}

async function getFallbackWindowId() {
  const { fallbackWindowId = null } = await chrome.storage.session.get('fallbackWindowId');
  return fallbackWindowId;
}

async function setFallbackWindowId(id) {
  await chrome.storage.session.set({ fallbackWindowId: id });
}

async function closeFallbackWindow() {
  const id = await getFallbackWindowId();
  if (id == null) return false;
  await setFallbackWindowId(null);
  try {
    await chrome.windows.remove(id);
  } catch {
    /* already gone */
  }
  return true;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

async function togglePalette(tab) {
  // A second press while the fallback window is open closes it.
  if (await closeFallbackWindow()) return;

  tab ??= await getActiveTab();
  if (!tab?.id) return;

  if (!isRestricted(tab.url)) {
    // Already injected? Then it just toggles.
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'zelium:toggle' });
      return;
    } catch {
      /* no listener yet — inject below */
    }
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PALETTE_FILES });
      return;
    } catch {
      /* not scriptable after all — use the fallback window */
    }
  }

  await openFallbackWindow(tab);
}

async function openFallbackWindow(tab) {
  const width = 700;
  const height = 520;
  let left;
  let top;
  try {
    const win = await chrome.windows.get(tab.windowId);
    left = Math.round(win.left + (win.width - width) / 2);
    top = Math.round(win.top + Math.max(48, (win.height - height) * 0.25));
  } catch {
    /* let the browser place it */
  }
  const url = chrome.runtime.getURL(`fallback.html?tab=${tab.id}`);
  const win = await chrome.windows.create({ url, type: 'popup', width, height, left, top, focused: true });
  await setFallbackWindowId(win.id);
  // Some builds/launch flags ignore the size on create; enforce it.
  if (win.width !== width || win.height !== height) {
    try {
      await chrome.windows.update(win.id, { width, height, left, top });
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Messages from the palette UI
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (typeof msg?.type !== 'string' || !msg.type.startsWith('zelium:')) return false;
  if (msg.type === 'zelium:toggle') return false; // handled by content scripts
  handle(msg, sender).then(
    (data) => sendResponse({ ok: true, data }),
    (err) => sendResponse({ ok: false, error: String(err?.message ?? err) }),
  );
  return true; // async response
});

async function contextTab(msg, sender) {
  const id = msg.tabId ?? sender.tab?.id;
  if (id != null) {
    try {
      return await chrome.tabs.get(id);
    } catch {
      /* tab closed meanwhile */
    }
  }
  return getActiveTab();
}

/** Actions coming from the fallback window first close it and refocus the browser window. */
async function prepareAction(msg, ctx) {
  if (msg.fallback) await closeFallbackWindow();
  if (ctx?.windowId != null) {
    try {
      await chrome.windows.update(ctx.windowId, { focused: true });
    } catch {
      /* ignore */
    }
  }
}

async function handle(msg, sender) {
  const ctx = await contextTab(msg, sender);
  switch (msg.type) {
    case 'zelium:snapshot':
      return snapshot(ctx);

    case 'zelium:history':
      return searchHistory(msg.text);

    case 'zelium:switchTab':
      await prepareAction(msg, ctx);
      return switchToTab(msg.id);

    case 'zelium:open':
      await prepareAction(msg, ctx);
      return openUrl(msg.url, msg.disposition, ctx);

    case 'zelium:search':
      await prepareAction(msg, ctx);
      return webSearch(msg.text, msg.disposition, ctx);

    case 'zelium:restore':
      await prepareAction(msg, ctx);
      return chrome.sessions.restore(msg.sessionId);

    case 'zelium:moveToWindow':
      await prepareAction(msg, ctx);
      return chrome.windows.create({ tabId: msg.id, focused: true });

    case 'zelium:closeTab':
      await chrome.tabs.remove(msg.id);
      return true;

    case 'zelium:deleteHistory':
      await chrome.history.deleteUrl({ url: msg.url });
      return true;

    case 'zelium:command':
      await prepareAction(msg, ctx);
      return runCommand(msg.id, ctx);

    default:
      throw new Error(`Unknown message ${msg.type}`);
  }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

function slimTab(t) {
  return {
    id: t.id,
    windowId: t.windowId,
    index: t.index,
    title: t.title || t.url || '',
    url: t.url || t.pendingUrl || '',
    pinned: t.pinned,
    audible: t.audible,
    muted: !!t.mutedInfo?.muted,
    active: t.active,
    lastAccessed: t.lastAccessed ?? 0,
  };
}

function flattenBookmarks(nodes, path = [], out = []) {
  for (const node of nodes) {
    if (node.url) {
      out.push({
        id: node.id,
        title: node.title || node.url,
        url: node.url,
        folder: path.join(' / '),
        dateAdded: node.dateAdded ?? 0,
      });
    } else if (node.children) {
      flattenBookmarks(node.children, node.title ? [...path, node.title] : path, out);
    }
  }
  return out;
}

function slimHistory(h) {
  return {
    id: h.id,
    title: h.title || h.url,
    url: h.url,
    lastVisitTime: h.lastVisitTime ?? 0,
    visitCount: h.visitCount ?? 0,
  };
}

async function snapshot(ctx) {
  const ownOrigin = chrome.runtime.getURL('');
  const [tabs, tree, history, closed, windows] = await Promise.all([
    chrome.tabs.query({}),
    chrome.bookmarks.getTree(),
    chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_SNAPSHOT_SIZE }),
    chrome.sessions.getRecentlyClosed({ maxResults: 10 }),
    chrome.windows.getAll({ windowTypes: ['normal'] }),
  ]);

  const closedEntries = [];
  for (const s of closed) {
    if (s.tab) {
      closedEntries.push({
        sessionId: s.tab.sessionId,
        title: s.tab.title || s.tab.url,
        url: s.tab.url,
        lastModified: (s.lastModified ?? 0) * 1000,
      });
    } else if (s.window) {
      const n = s.window.tabs?.length ?? 0;
      closedEntries.push({
        sessionId: s.window.sessionId,
        title: `Window (${n} tab${n === 1 ? '' : 's'})`,
        url: s.window.tabs?.[0]?.url ?? '',
        isWindow: true,
        lastModified: (s.lastModified ?? 0) * 1000,
      });
    }
  }

  return {
    current: ctx ? slimTab(ctx) : null,
    windowCount: windows.length,
    tabs: tabs.filter((t) => !(t.url || '').startsWith(ownOrigin)).map(slimTab),
    bookmarks: flattenBookmarks(tree),
    history: history.map(slimHistory),
    closed: closedEntries,
  };
}

async function searchHistory(text) {
  if (!text) return [];
  const items = await chrome.history.search({ text, startTime: 0, maxResults: HISTORY_QUERY_SIZE });
  return items.map(slimHistory);
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

function assertSafeUrl(url) {
  if (typeof url !== 'string' || !url || /^\s*javascript:/i.test(url)) {
    throw new Error('Refusing to open this URL');
  }
}

async function switchToTab(id) {
  const tab = await chrome.tabs.update(id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  return true;
}

async function openUrl(url, disposition = 'current', ctx) {
  assertSafeUrl(url);
  if (disposition === 'newWindow') {
    await chrome.windows.create({ url, focused: true });
  } else if (disposition === 'newTab' || !ctx) {
    await chrome.tabs.create({
      url,
      windowId: ctx?.windowId,
      index: ctx ? ctx.index + 1 : undefined,
      active: true,
    });
  } else {
    await chrome.tabs.update(ctx.id, { url });
  }
  return true;
}

async function webSearch(text, disposition = 'current', ctx) {
  if (chrome.search?.query) {
    const map = { current: 'CURRENT_TAB', newTab: 'NEW_TAB', newWindow: 'NEW_WINDOW' };
    const opts = { text, disposition: map[disposition] ?? 'CURRENT_TAB' };
    if (opts.disposition === 'CURRENT_TAB') {
      if (ctx?.id == null) opts.disposition = 'NEW_TAB';
      else opts.tabId = ctx.id;
    }
    await chrome.search.query(opts);
    return true;
  }
  // Very old / stripped builds without chrome.search: fall back to DuckDuckGo.
  return openUrl(`https://duckduckgo.com/?q=${encodeURIComponent(text)}`, disposition, ctx);
}

async function windowTabs(ctx) {
  return chrome.tabs.query({ windowId: ctx.windowId });
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url || '';
  }
}

function normalizeForDupes(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href;
  } catch {
    return url;
  }
}

async function setZoom(ctx, direction) {
  if (direction === 0) return chrome.tabs.setZoom(ctx.id, 0); // 0 = browser default
  const current = await chrome.tabs.getZoom(ctx.id);
  const next =
    direction > 0
      ? ZOOM_STEPS.find((z) => z > current + 0.001) ?? ZOOM_STEPS.at(-1)
      : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001) ?? ZOOM_STEPS[0];
  return chrome.tabs.setZoom(ctx.id, next);
}

const INTERNAL_PAGES = {
  'page.history': 'chrome://history',
  'page.downloads': 'chrome://downloads',
  'page.bookmarks': 'chrome://bookmarks',
  'page.extensions': 'chrome://extensions',
  'page.settings': 'chrome://settings',
  'page.shortcuts': 'chrome://extensions/shortcuts',
};

async function runCommand(id, ctx) {
  if (INTERNAL_PAGES[id]) {
    await chrome.tabs.create({ url: INTERNAL_PAGES[id], windowId: ctx?.windowId, index: ctx ? ctx.index + 1 : undefined });
    return true;
  }

  switch (id) {
    case 'tab.new':
      await chrome.tabs.create({ windowId: ctx?.windowId, index: ctx ? ctx.index + 1 : undefined });
      return true;
    case 'window.new':
      await chrome.windows.create({ focused: true });
      return true;
    case 'window.incognito':
      await chrome.windows.create({ incognito: true, focused: true });
      return true;
    case 'session.reopen':
      await chrome.sessions.restore();
      return true;
  }

  if (!ctx) throw new Error('No active tab');

  switch (id) {
    case 'tab.close':
      await chrome.tabs.remove(ctx.id);
      break;
    case 'tab.closeOthers': {
      const ids = (await windowTabs(ctx)).filter((t) => t.id !== ctx.id && !t.pinned).map((t) => t.id);
      if (ids.length) await chrome.tabs.remove(ids);
      break;
    }
    case 'tab.closeRight': {
      const ids = (await windowTabs(ctx)).filter((t) => t.index > ctx.index && !t.pinned).map((t) => t.id);
      if (ids.length) await chrome.tabs.remove(ids);
      break;
    }
    case 'tab.closeDuplicates': {
      const seen = new Set();
      const tabs = (await windowTabs(ctx)).sort((a, b) => (b.active - a.active) || (b.pinned - a.pinned) || a.index - b.index);
      const dupes = [];
      for (const t of tabs) {
        const key = normalizeForDupes(t.url);
        if (seen.has(key)) dupes.push(t.id);
        else seen.add(key);
      }
      if (dupes.length) await chrome.tabs.remove(dupes);
      break;
    }
    case 'tab.sortByDomain': {
      const tabs = (await windowTabs(ctx)).filter((t) => !t.pinned);
      if (!tabs.length) break;
      const start = Math.min(...tabs.map((t) => t.index));
      const sorted = [...tabs].sort(
        (a, b) => hostOf(a.url).localeCompare(hostOf(b.url)) || (a.title || '').localeCompare(b.title || ''),
      );
      await chrome.tabs.move(sorted.map((t) => t.id), { index: start });
      break;
    }
    case 'tab.duplicate':
      await chrome.tabs.duplicate(ctx.id);
      break;
    case 'tab.togglePin':
      await chrome.tabs.update(ctx.id, { pinned: !ctx.pinned });
      break;
    case 'tab.toggleMute':
      await chrome.tabs.update(ctx.id, { muted: !ctx.mutedInfo?.muted });
      break;
    case 'tab.reload':
      await chrome.tabs.reload(ctx.id);
      break;
    case 'tab.hardReload':
      await chrome.tabs.reload(ctx.id, { bypassCache: true });
      break;
    case 'tab.toWindow':
      await chrome.windows.create({ tabId: ctx.id, focused: true });
      break;
    case 'zoom.in':
      await setZoom(ctx, 1);
      break;
    case 'zoom.out':
      await setZoom(ctx, -1);
      break;
    case 'zoom.reset':
      await setZoom(ctx, 0);
      break;
    default:
      throw new Error(`Unknown command ${id}`);
  }
  return true;
}
