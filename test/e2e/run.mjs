#!/usr/bin/env node
/**
 * End-to-end test: launches a real Chromium browser with Zelium loaded and
 * drives the palette over the DevTools protocol. Runs on macOS, Windows and
 * Linux. No npm dependencies.
 *
 *   node test/e2e/run.mjs                        # auto-detect an installed browser
 *   CHROME_PATH=/path/to/browser node test/e2e/run.mjs
 *   ZELIUM_DOWNLOAD_CHROME=1 node test/e2e/run.mjs   # fetch Chrome for Testing via npx
 *   HEADLESS=0 node test/e2e/run.mjs             # watch it run
 *
 * The extension is copied to a temp dir and given <all_urls> host access
 * there, because DevTools can't press the real shortcut (which is what grants
 * activeTab in normal use). The shipped manifest is not changed.
 */
import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, platform, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listTargets, connect, waitFor, press } from './cdp.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEADLESS = process.env.HEADLESS !== '0';

// ---------------------------------------------------------------------------
// Find a browser
// ---------------------------------------------------------------------------

function candidates() {
  const p = platform();
  if (p === 'darwin') {
    return [
      'Helium',
      'Google Chrome for Testing',
      'Chromium',
      'Google Chrome',
      'Google Chrome Canary',
      'Brave Browser',
      'Microsoft Edge',
      'Vivaldi',
      'Opera',
      'Arc',
    ].flatMap((n) => [`/Applications/${n}.app/Contents/MacOS/${n}`, join(homedir(), `Applications/${n}.app/Contents/MacOS/${n}`)]);
  }
  if (p === 'win32') {
    const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
    const rel = [
      'Chromium\\Application\\chrome.exe',
      'Google\\Chrome\\Application\\chrome.exe',
      'BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'Microsoft\\Edge\\Application\\msedge.exe',
      'Vivaldi\\Application\\vivaldi.exe',
    ];
    return roots.flatMap((r) => rel.map((x) => join(r, x)));
  }
  return [
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/brave-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/vivaldi',
  ];
}

function downloadChromeForTesting() {
  const dir = join(tmpdir(), 'zelium-browsers');
  const out = execFileSync(
    platform() === 'win32' ? 'npx.cmd' : 'npx',
    ['--yes', '@puppeteer/browsers', 'install', 'chrome@stable', '--path', dir],
    { encoding: 'utf8', shell: platform() === 'win32' },
  );
  const line = out.trim().split('\n').pop();
  return line.slice(line.indexOf(' ') + 1).trim();
}

function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  if (process.env.ZELIUM_DOWNLOAD_CHROME === '1') return downloadChromeForTesting();
  const found = candidates().find((p) => existsSync(p));
  if (!found) throw new Error('No Chromium browser found. Set CHROME_PATH or ZELIUM_DOWNLOAD_CHROME=1.');
  return found;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PAGES = {
  '/a.html': `<!doctype html><title>Alpha Zed Page</title>
    <style>
      /* A hostile page: global resets that would wreck an un-isolated overlay. */
      * { color: red !important; font-size: 40px !important; font-family: serif !important; }
      zelium-palette { display: none !important; opacity: 0 !important; }
      html { transform: scale(1); filter: blur(0); }
    </style>
    <h1>Alpha</h1><input id="page-input">
    <script>
      window.__keys = 0;
      window.__keyLog = [];
      // A keylogger: capture phase on window runs before anything in the page.
      window.__captured = [];
      for (const type of ['keydown', 'keypress', 'keyup', 'input', 'beforeinput']) {
        window.addEventListener(type, (e) => window.__captured.push(type + ':' + (e.key ?? e.data)), true);
      }
      document.addEventListener('keydown', (e) => { window.__keys++; window.__keyLog.push(e.key + '@' + (document.activeElement?.tagName) + ' host=' + !!document.querySelector('zelium-palette') + ' focus=' + document.hasFocus()); });
    </script>`,
  '/b.html': `<!doctype html><title>Beta Docs</title><h1>Beta</h1>`,
  // Fake chat apps for the "ask AI" flow. chat.html: a contenteditable editor
  // that appears late and renders input a frame later (like Lexical), with a
  // send button that's disabled until there's text and a restored draft.
  '/chat.html': `<!doctype html><title>Chat</title><main id="app"></main>
    <script>
      window.__sent = [];
      setTimeout(() => {
        const ed = document.createElement('div');
        ed.contentEditable = 'true';
        ed.setAttribute('role', 'textbox');
        const btn = document.createElement('button');
        btn.setAttribute('aria-label', 'Send message');
        btn.disabled = true;
        ed.addEventListener('input', () => requestAnimationFrame(() => (btn.disabled = !ed.innerText.trim())));
        btn.addEventListener('click', () => { window.__sent.push(ed.innerText.trim()); ed.textContent = ''; btn.disabled = true; });
        document.getElementById('app').append(ed, btn);
        setTimeout(() => { if (!ed.innerText.trim()) ed.textContent = 'old draft'; }, 600);
      }, 400);
    </script>`,
  // chat-ta.html: a plain textarea that sends on Enter, no button.
  '/chat-ta.html': `<!doctype html><title>Chat TA</title><textarea id="chat-input"></textarea>
    <script>
      window.__sent = [];
      const ta = document.getElementById('chat-input');
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); window.__sent.push(ta.value.trim()); ta.value = ''; }
      });
    </script>`,
  '/rtl.html': `<!doctype html><html dir="rtl" lang="ar"><title>صفحة</title><body style="direction:rtl">مرحبا</body></html>`,
  '/data.xml': `<?xml version="1.0"?><root><item>xml</item></root>`,
  '/img.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#74ade8"/></svg>`,
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const body = PAGES[req.url.split('?')[0]];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      const type = req.url.endsWith('.xml')
        ? 'application/xml'
        : req.url.endsWith('.svg')
          ? 'image/svg+xml'
          : 'text/html; charset=utf-8';
      res.writeHead(200, { 'content-type': type }).end(body);
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function prepareExtension(dir) {
  const ext = join(dir, 'ext');
  cpSync(join(ROOT, 'src'), ext, { recursive: true });
  const manifestPath = join(ext, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return ext;
}

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

const results = [];
async function test(name, fn) {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name} (${Date.now() - start}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  ✗ ${name}\n      ${String(err?.message ?? err).split('\n').join('\n      ')}`);
  }
}

// CDP modifier bits: Ctrl = 2, Meta = 4. The palette uses ⌘ on macOS, Ctrl elsewhere.
const MOD_FOR_ACTIONS = platform() === 'darwin' ? 4 : 2;

/** Real key presses that insert text (Input.insertText fires no key events). */
async function typeChars(conn, text) {
  for (const ch of text) {
    const code = `Key${ch.toUpperCase()}`;
    const keyCode = ch.toUpperCase().charCodeAt(0);
    await conn.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ch, code, windowsVirtualKeyCode: keyCode, text: ch });
    await conn.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch, code, windowsVirtualKeyCode: keyCode });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

async function main() {
  const browserPath = findBrowser();
  const dir = mkdtempSync(join(tmpdir(), 'zelium-e2e-'));
  const ext = prepareExtension(dir);
  const profile = join(dir, 'profile');
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;

  console.log(`Browser: ${browserPath}`);
  console.log(`Platform: ${platform()}  headless: ${HEADLESS}\n`);

  const args = [
    `--user-data-dir=${profile}`,
    `--load-extension=${ext}`,
    `--disable-extensions-except=${ext}`,
    // Branded Chrome 137+ ignores --load-extension unless this is set.
    '--disable-features=DisableLoadExtensionCommandLineSwitch',
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-search-engine-choice-screen',
    '--window-size=1280,860',
    ...(HEADLESS ? ['--headless=new'] : []),
    ...(platform() === 'linux' ? ['--no-sandbox'] : []),
    'about:blank',
  ];
  const child = spawn(browserPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));

  const cleanup = () => {
    if (platform() === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
    else child.kill('SIGKILL');
    server.close();
    for (let i = 0; i < 5; i++) {
      try {
        rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        /* Windows file locks: retry */
      }
    }
  };

  try {
    const port = await waitFor(
      () => {
        const f = join(profile, 'DevToolsActivePort');
        return existsSync(f) && Number(readFileSync(f, 'utf8').split('\n')[0]);
      },
      { timeout: 30000, message: `DevTools port (browser stderr: ${stderr.slice(-400)})` },
    );

    const findTarget = async (pred) => (await listTargets(port)).find(pred);

    // Find Zelium's worker by name: browsers ship their own component extensions
    // (e.g. Chrome's "Gemini in Chrome") that also run a background.js worker.
    async function findZeliumWorker() {
      const workers = (await listTargets(port)).filter((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://'));
      for (const t of workers) {
        const conn = connect(t.webSocketDebuggerUrl);
        try {
          const name = await conn.evaluate(`typeof chrome !== 'undefined' && chrome.runtime?.getManifest?.().name`);
          if (name === 'Zelium') return { t, conn };
        } catch {
          /* not ready / not ours */
        }
        conn.close();
      }
      return null;
    }

    let sw;
    let extId;
    await test('extension loads (service worker running)', async () => {
      const found = await waitFor(findZeliumWorker, {
        timeout: 20000,
        message: 'Zelium service worker — the browser may block --load-extension (branded Chrome 137+ does)',
      });
      sw = found.conn;
      extId = new URL(found.t.url).host;
    });
    if (!sw) {
      cleanup();
      console.log('\nExtension did not load; skipping the remaining tests.');
      process.exit(1);
    }

    const swEval = (expr) => sw.evaluate(`(async () => { ${expr} })()`);
    // Tabs are tracked by id: browsers rewrite internal URLs (Edge: chrome:// → edge://).
    const tabIds = {};
    const getTab = (key) => swEval(`return await chrome.tabs.get(${tabIds[key]})`);
    async function openTab(key, url, active = true) {
      tabIds[key] = await swEval(`return (await chrome.tabs.create({ url: ${JSON.stringify(url)}, active: ${active} })).id`);
      await waitFor(() => getTab(key).then((t) => t.status === 'complete'), { timeout: 10000, message: `${key} loaded` });
    }
    const toggle = (key) =>
      swEval(`const t = await chrome.tabs.get(${tabIds[key]});
              await chrome.tabs.update(t.id, { active: true });
              await chrome.windows.update(t.windowId, { focused: true });
              await togglePalette(t);`);

    await test('welcome page opens on install and shows the shortcut', async () => {
      const t = await waitFor(() => findTarget((t) => t.url.includes('/welcome.html')), { message: 'welcome tab' });
      const page = connect(t.webSocketDebuggerUrl);
      const text = await waitFor(
        async () => {
          const v = await page.evaluate(`document.getElementById('shortcut').textContent`);
          return v !== '…' && v;
        },
        { message: 'shortcut label' },
      );
      console.log(`      shortcut: ${text}`);
      assert(text !== 'not set', 'the browser did not assign the default shortcut (conflict)');
      page.close();
    });

    await test('recently-used tab updates that overlap are all kept', async () => {
      const kept = await swEval(`
        await Promise.all(['x1', 'x2', 'x3', 'x4'].map((k) => updateMru((m) => { m[k] = 1; })));
        const { mru } = await chrome.storage.session.get('mru');
        const n = ['x1', 'x2', 'x3', 'x4'].filter((k) => k in mru).length;
        await updateMru((m) => { for (const k of ['x1', 'x2', 'x3', 'x4']) delete m[k]; });
        return n;`);
      assert(kept === 4, `only ${kept} of 4 updates kept`);
    });

    // Attach to page A with a listener for the extension's isolated world.
    async function attach(suffix) {
      const t = await waitFor(() => findTarget((t) => t.type === 'page' && t.url.endsWith(suffix)), { message: `tab ${suffix}` });
      const page = connect(t.webSocketDebuggerUrl);
      // The palette runs in the overlay's extension iframe (its own target).
      let frame = null;
      page.frame = async () => {
        const ft = await waitFor(
          () => findTarget((f) => f.type === 'iframe' && f.parentId === t.id && f.url.includes('/frame.html')),
          { message: `palette iframe in ${suffix}` },
        );
        if (frame?.id !== ft.id) {
          frame?.conn.close();
          frame = { id: ft.id, conn: connect(ft.webSocketDebuggerUrl) };
        }
        return frame.conn;
      };
      page.palette = async (expr) =>
        (await page.frame()).evaluate(`(() => { const p = Zelium.instance?.palette; return ${expr}; })()`);
      page.overlayShown = () =>
        page.evaluate(`(() => { const h = document.querySelector('zelium-palette'); return !!h && getComputedStyle(h).display !== 'none'; })()`);
      const close = page.close;
      page.close = () => {
        frame?.conn.close();
        close();
      };
      return page;
    }

    /** Toggle the palette open on a tab and wait until it is open AND focused. */
    async function openOn(key, page) {
      await toggle(key);
      await waitFor(
        async () =>
          (await page.palette('p && p.isOpen')) &&
          (await page.evaluate(`document.activeElement?.localName === 'zelium-palette'`)),
        { message: 'palette open and focused' },
      );
    }

    /** Press Escape and wait until the overlay is gone (no-op if a page reload already removed it). */
    async function closeOn(page) {
      if (!(await page.overlayShown())) return;
      await press(page, 'Escape');
      await waitFor(async () => !(await page.overlayShown()), { message: 'palette closed' });
    }

    let a;
    await test('overlay opens on a page with hostile CSS', async () => {
      await openTab('a', `${base}/a.html`);
      a = await attach('/a.html');
      await a.send('Page.bringToFront');
      await openOn('a', a);
      const host = await a.evaluate(`(() => {
        const h = document.querySelector('zelium-palette');
        return h && { display: getComputedStyle(h).display, opacity: getComputedStyle(h).opacity,
                      top: h.matches?.(':popover-open') ?? null };
      })()`);
      assert(host, 'host element missing');
      assert(host.display === 'block' && host.opacity === '1', `host hidden by page CSS: ${JSON.stringify(host)}`);
      const font = await a.palette(`getComputedStyle(p.input).fontSize`);
      assert(font === '14px', `page CSS leaked into palette (input font-size ${font})`);
    });

    await test('typing filters open tabs (fuzzy)', async () => {
      await openTab('b', `${base}/b.html`, false);
      // Re-open so the snapshot includes tab B.
      await closeOn(a);
      await openOn('a', a);
      // The palette shows the previous snapshot instantly, then refreshes: wait for fresh data.
      await waitFor(() => a.palette(`p.snapshot.tabs.some((t) => t.title === 'Beta Docs')`), { message: 'fresh snapshot' });
      await a.send('Input.insertText', { text: 'beta dcs' });
      await waitFor(() => a.palette(`p.rows[0]?.title === 'Beta Docs' && p.rows[0].kind === 'tab'`), {
        message: 'Beta Docs as first result',
      });
    });

    await test('keystrokes do not leak to the page (not even to capture listeners)', async () => {
      assert(await a.palette('p && p.isOpen'), 'palette not open');
      await a.evaluate('window.__keys = 0; window.__keyLog = []; window.__captured = []');
      const before = await a.palette('p.input.value');
      await typeChars(a, 'sec');
      await press(a, 'ArrowDown');
      await press(a, 'ArrowUp');
      await waitFor(() => a.palette(`p.input.value === ${JSON.stringify(before + 'sec')}`), { message: 'typed text in the palette' });
      const leaked = await a.evaluate('window.__keys');
      assert(leaked === 0, `page saw ${leaked} keydown events: ${await a.evaluate('JSON.stringify(window.__keyLog)')}`);
      const captured = await a.evaluate('JSON.stringify(window.__captured)');
      assert(captured === '[]', `page's capture listeners saw: ${captured}`);
      // Put the query back for the next test.
      for (let i = 0; i < 3; i++) await press(a, 'Backspace');
    });

    await test('Enter switches to the selected tab', async () => {
      await press(a, 'Enter');
      await waitFor(async () => (await swEval(`return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url`))?.endsWith('/b.html'), {
        message: 'tab B active',
      });
    });

    await test('calculator row', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.send('Input.insertText', { text: '2*(3+4)^2' });
      const row = await waitFor(() => a.palette(`p.rows[0]`), { message: 'calc row' });
      assert(row.kind === 'calc' && row.title === '= 98', `got ${JSON.stringify(row.title)}`);
      await closeOn(a);
    });

    await test('pasted "/r/rust" stays a query instead of switching to history', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.palette(`(p.input.value = '/r/rust', p.input.dispatchEvent(new InputEvent('input', { inputType: 'insertFromPaste' })), true)`);
      await a.send('Input.insertText', { text: 'x' });
      const state = await waitFor(() => a.palette(`p.query === '/r/rustx' && { mode: p.mode, query: p.query }`), { message: 'query' });
      assert(state.mode === 'all', `mode ${state.mode}`);
      await closeOn(a);
    });

    await test('> command mode runs a command (Pin Tab)', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.send('Input.insertText', { text: '>pin tab' });
      const mode = await a.palette('p.mode');
      assert(mode === 'commands', `mode is ${mode}`);
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'tab.togglePin'`), { message: 'Pin Tab row' });
      await press(a, 'Enter');
      await waitFor(() => getTab('a').then((t) => t.pinned), { message: 'tab pinned' });
      await swEval(`await chrome.tabs.update(${tabIds.a}, { pinned: false })`);
    });

    await test('bookmarklets stay open with a message instead of failing silently', async () => {
      const id = await swEval(`return (await chrome.bookmarks.create({ title: 'Zelium Bookmarklet', url: 'javascript:void(0)' })).id`);
      try {
        await a.send('Page.bringToFront');
        await openOn('a', a);
        await waitFor(() => a.palette(`p.snapshot.bookmarks.some((b) => b.id === ${JSON.stringify(id)})`), { message: 'fresh snapshot' });
        await a.send('Input.insertText', { text: '#zelium bookmarklet' });
        const row = await waitFor(() => a.palette(`p.rows[0]?.kind === 'bookmark' && p.rows[0]`), { message: 'bookmarklet row' });
        assert(row.sub === 'bookmarklet', `sub ${row.sub}`);
        await press(a, 'Enter');
        await waitFor(() => a.palette(`p.footRight.textContent.includes('Bookmarklets')`), { message: 'bookmarklet message' });
        assert(await a.palette('p.isOpen'), 'palette closed');
        await closeOn(a);
      } finally {
        await swEval(`await chrome.bookmarks.remove(${JSON.stringify(id)})`);
      }
    });

    await test("> Copy All Tabs as Markdown List copies the window's tabs", async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.palette('(p.copyText = async (text) => ((window.__copied = text), true), true)');
      await a.send('Input.insertText', { text: '>copy all tabs markdown' });
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'copy.windowMarkdown'`), { message: 'command row' });
      await press(a, 'Enter');
      const copied = await waitFor(() => a.palette('window.__copied'), { message: 'copied text' });
      assert(copied.includes(`- [Alpha Zed Page](${base}/a.html)`), copied);
      await closeOn(a);
    });

    await test('> Bookmark Page, Remove Bookmark, Bookmark Page in Folder…', async () => {
      const url = `${base}/a.html`;
      const marks = () => swEval(`return await chrome.bookmarks.search({ url: ${JSON.stringify(url)} })`);
      const run = async (text, id) => {
        await a.send('Page.bringToFront');
        await openOn('a', a);
        await waitFor(() => a.palette('p.snapshotReady && p.snapshot.current?.url === ' + JSON.stringify(url)), { message: 'snapshot' });
        await a.send('Input.insertText', { text });
        await waitFor(() => a.palette(`p.rows[0]?.data?.id === '${id}' && p.rows[0].title`), { message: `${id} row` }).catch(async (err) => {
          throw new Error(`${err.message}; state ${await a.palette('JSON.stringify({ open: p.isOpen, mode: p.mode, q: p.query, rows: p.rows.slice(0, 3).map((r) => r.title) })')}`);
        });
        await press(a, 'Enter');
      };
      try {
        await run('>bookmark page', 'bookmark.toggle');
        await waitFor(async () => (await marks()).length === 1, { message: 'bookmark created' });
        await waitFor(async () => !(await a.overlayShown()), { message: 'palette closed' });

        await run('>remove bookmark', 'bookmark.toggle');
        await waitFor(async () => (await marks()).length === 0, { message: 'bookmark removed' });
        await waitFor(async () => !(await a.overlayShown()), { message: 'palette closed' });

        await run('>bookmark page in folder', 'bookmark.folder');
        const folder = await waitFor(() => a.palette(`p.view && p.rows[0]?.kind === 'action' && p.rows[0].data.id`), { message: 'folder picker' });
        // Esc goes back to the commands, Enter in the picker bookmarks.
        await press(a, 'Escape');
        await waitFor(() => a.palette(`!p.view && p.mode === 'commands' && p.query === 'bookmark page in folder'`), { message: 'back to commands' });
        await press(a, 'Enter');
        await waitFor(() => a.palette(`p.view && p.rows[0]?.kind === 'action'`), { message: 'folder picker again' });
        await press(a, 'Enter');
        const [mark] = await waitFor(async () => {
          const m = await marks();
          return m.length === 1 && m;
        }, { message: 'bookmark in folder' });
        assert(`folder:${mark.parentId}` === folder, `parent ${mark.parentId}, picked ${folder}`);
        await waitFor(async () => !(await a.overlayShown()), { message: 'palette closed' });
      } finally {
        await swEval(`for (const b of await chrome.bookmarks.search({ url: ${JSON.stringify(url)} })) await chrome.bookmarks.remove(b.id)`);
      }
    });

    await test('actions menu (Ctrl+.): pin another tab, Esc goes back', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.send('Input.insertText', { text: '@beta docs' });
      await waitFor(() => a.palette(`p.rows[0]?.kind === 'tab' && p.rows[0].title === 'Beta Docs'`), { message: 'Beta tab row' });
      await a.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '.', code: 'Period', windowsVirtualKeyCode: 190, modifiers: MOD_FOR_ACTIONS });
      await a.send('Input.dispatchKeyEvent', { type: 'keyUp', key: '.', code: 'Period', windowsVirtualKeyCode: 190, modifiers: MOD_FOR_ACTIONS });
      const titles = await waitFor(() => a.palette(`p.view?.title === 'Actions' && p.rows.map((r) => r.title)`), { message: 'actions menu' });
      assert(titles.includes('Pin Tab') && titles.includes('Copy URL'), JSON.stringify(titles));
      await press(a, 'Escape');
      await waitFor(() => a.palette(`!p.view && p.query === 'beta docs' && p.isOpen`), { message: 'back to results' });
      await a.palette(`(p.openActions(p.rows[0]), true)`);
      await a.send('Input.insertText', { text: 'pin' });
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'pin'`), { message: 'Pin action' });
      await press(a, 'Enter');
      await waitFor(() => getTab('b').then((t) => t.pinned), { message: 'tab B pinned' });
      const active = await swEval(`return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id`);
      assert(active === tabIds.a, 'the current tab changed');
      await swEval(`await chrome.tabs.update(${tabIds.b}, { pinned: false })`);
      await closeOn(a);
    });

    await test('learns from picks: a chosen result ranks first next time; Clear Learned Results', async () => {
      const openWith = async (text) => {
        await a.send('Page.bringToFront');
        await openOn('a', a);
        await a.palette('(p.copyText = async () => true, true)');
        await waitFor(() => a.palette('p.prefsReady?.then(() => true)'), { message: 'settings and picks loaded' });
        await a.send('Input.insertText', { text });
      };
      await openWith('>copy');
      const idx = await waitFor(() => a.palette(`(() => { const i = p.rows.findIndex((r) => r.data?.id === 'copy.title'); return i > 0 && i; })()`), {
        message: 'Copy Page Title below the first row',
      });
      await a.palette(`(p.select(${idx}, true), true)`);
      await press(a, 'Enter');
      await waitFor(async () => !(await a.overlayShown()), { message: 'palette closed' });

      await openWith('>copy');
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'copy.title'`), { message: 'learned command first in > mode' });
      await closeOn(a);
      await openWith('copy');
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'copy.title'`), { message: 'top hit in the main search' });
      await closeOn(a);

      await openWith('>clear learned');
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'learn.clear'`), { message: 'Clear Learned Results' });
      await press(a, 'Enter');
      await waitFor(async () => !(await swEval(`return (await chrome.storage.local.get('picks')).picks`)), { message: 'picks cleared' });
      await waitFor(async () => !(await a.overlayShown()), { message: 'palette closed' });
      await openWith('>copy');
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'copy.url'`), { message: 'default order again' });
      await closeOn(a);
    });

    await test('Ask Claude About This Page: message with title, URL and the page selection', async () => {
      await a.send('Page.bringToFront');
      await a.evaluate(`(() => { const r = document.createRange(); r.selectNodeContents(document.querySelector('h1')); getSelection().removeAllRanges(); getSelection().addRange(r); })()`);
      await openOn('a', a);
      await a.palette(`(p._send ??= p.send, p.send = async (type, data) => type === 'aiChat' ? ((window.__ai = data), true) : p._send(type, data), window.__ai = null, true)`);
      try {
        await a.send('Input.insertText', { text: '>ask claude about this page' });
        await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'ai.claude.page'`), { message: 'page command' });
        await press(a, 'Tab');
        await waitFor(() => a.palette(`p.rows[0]?.kind === 'ask' && p.rows[0].data.page`), { message: 'page ask row with the default prompt' });
        await a.send('Input.insertText', { text: 'explain it' });
        const title = await waitFor(() => a.palette(`p.rows[0]?.data?.text === 'explain it' && p.rows[0].title`), { message: 'ask row' });
        assert(title === 'Ask Claude about this page: explain it', title);
        await press(a, 'Enter');
        const sent = await waitFor(() => a.palette('window.__ai'), { message: 'aiChat message' });
        assert(sent.url === 'https://claude.ai/new', sent.url);
        const want = `explain it\n\nPage: Alpha Zed Page\n${base}/a.html\n\nSelected text:\n"""\nAlpha\n"""`;
        assert(sent.text === want, JSON.stringify(sent.text));
      } finally {
        await a.palette('(p.send = p._send, true)');
        await a.evaluate('getSelection().removeAllRanges()');
      }
    });

    await test('> AI command opens a new Claude chat in a new tab', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      await a.send('Input.insertText', { text: '>claude' });
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'ai.claude'`), { message: 'Claude row' });
      await press(a, 'Enter');
      const id = await waitFor(
        () => swEval(`return (await chrome.tabs.query({})).find((t) => (t.pendingUrl || t.url || '').startsWith('https://claude.ai/new'))?.id`),
        { message: 'claude.ai tab' },
      );
      const still = await getTab('a');
      assert(still.url.startsWith('http://127.0.0.1'), `current tab navigated away: ${still.url}`);
      await swEval(`await chrome.tabs.remove(${id})`);
    });

    await test('"claude: <message>" offers to ask Claude; Tab on the command starts one', async () => {
      await closeOn(a);
      await openOn('a', a);
      // Without the colon it's an ordinary search in the main box.
      await a.send('Input.insertText', { text: 'claude what is MV3' });
      await waitFor(() => a.palette(`p.query === 'claude what is MV3' && p.rows.length > 0`), { message: 'results' });
      assert(!(await a.palette(`p.rows.some((r) => r.kind === 'ask')`)), 'bare "claude …" offered to ask in the main search');
      await closeOn(a);
      await openOn('a', a);
      await a.send('Input.insertText', { text: 'claude: what is MV3' });
      const row = await waitFor(() => a.palette(`p.rows[0]?.kind === 'ask' && p.rows[0]`), { message: 'ask row' });
      assert(row.data.ai.id === 'ai.claude' && row.data.text === 'what is MV3', JSON.stringify(row.data));
      await closeOn(a);
      await openOn('a', a);
      await a.send('Input.insertText', { text: '>gemini' });
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'ai.gemini'`), { message: 'Gemini row' });
      await press(a, 'Tab');
      const value = await waitFor(() => a.palette(`p.input.value === 'gemini ' && p.input.value`), { message: 'completed input' });
      assert(value === 'gemini ', value);
      await closeOn(a);
    });

    for (const [page, expected] of [
      ['/chat.html', 'sent:button'],
      ['/chat-ta.html', 'sent:enter'],
    ]) {
      await test(`ask AI: types the message and sends it (${page})`, async () => {
        // Multi-line, like an Ask … About This Page message.
        const message = 'hello from zelium\n\nPage: Alpha\nhttp://x.test/a';
        const result = await swEval(`return await openAiChat(${JSON.stringify(base + page)}, ${JSON.stringify(message)}, 'newTab')`);
        assert(result === expected, `result ${result}`);
        const id = await swEval(`return (await chrome.tabs.query({})).find((t) => t.url === ${JSON.stringify(base + page)})?.id`);
        const sent = await swEval(
          `return (await chrome.scripting.executeScript({ target: { tabId: ${id} }, world: 'MAIN', func: () => window.__sent }))[0].result`,
        );
        const norm = (s) => s.replace(/\s+/g, ' ').trim();
        assert(sent?.length === 1 && norm(sent[0]) === norm(message), `sent ${JSON.stringify(sent)}`);
        await swEval(`await chrome.tabs.remove(${id})`);
      });
    }

    await test('!bangs: full Helium list loads on demand', async () => {
      await a.send('Page.bringToFront');
      await openOn('a', a);
      // "crates" isn't in the built-in set, so this needs the full list.
      await a.send('Input.insertText', { text: 'serde !crates' });
      const url = await waitFor(() => a.palette(`p.rows[0]?.kind === 'bangSearch' && p.rows[0].url`), { message: 'bang row' });
      assert(url === 'https://crates.io/search?q=serde', url);
    });

    await test('!bangs: suggestions, then Enter + "!w " opens the site', async () => {
      await closeOn(a);
      await openOn('a', a);
      await a.send('Input.insertText', { text: '!w' });
      await waitFor(() => a.palette(`p.rows[0]?.kind === 'bang' && p.rows[0].data.key === 'w'`), { message: '!w suggestion' });
      await press(a, 'Enter'); // completes to "!w "
      const row = await waitFor(() => a.palette(`p.input.value === '!w ' && p.rows[0]`), { message: 'completed bang' });
      assert(row.kind === 'bangSearch' && row.url === 'https://wikipedia.org', JSON.stringify(row.url));
    });

    await test('Escape closes the overlay without leaking the key', async () => {
      await a.evaluate('window.__keys = 0; window.__keyLog = []');
      assert(await a.overlayShown(), 'palette not open before Escape');
      await closeOn(a);
      const leaked = await a.evaluate('window.__keys');
      assert(leaked === 0, `page saw the Escape: ${await a.evaluate('JSON.stringify(window.__keyLog)')}`);
    });

    await test('layout stays left-to-right on RTL pages', async () => {
      await openTab('rtl', `${base}/rtl.html`);
      const r = await attach('/rtl.html');
      await r.send('Page.bringToFront');
      await openOn('rtl', r);
      const dir = await r.palette(`getComputedStyle(p.wrap).direction`);
      assert(dir === 'ltr', `direction ${dir}`);
      await press(r, 'Escape');
      r.close();
    });

    const fallbackTarget = () => findTarget((t) => t.type === 'page' && t.url.includes('/fallback.html'));

    await test('fallback window on browser-internal pages', async () => {
      await openTab('internal', 'chrome://version');
      await toggle('internal');
      const t = await waitFor(fallbackTarget, { message: 'fallback window' });
      const fb = connect(t.webSocketDebuggerUrl);
      const n = await waitFor(() => fb.evaluate(`document.querySelectorAll('.z-row').length`), { message: 'fallback rows' });
      assert(n > 0, 'fallback shows no rows');
      const popup = await swEval(`return (await chrome.windows.getAll()).filter(w => w.type === 'popup').length`);
      assert(popup === 1, `expected 1 popup window, got ${popup}`);
      // Pressing the shortcut again closes it.
      await toggle('internal');
      await waitFor(async () => !(await fallbackTarget()), { message: 'fallback closed' });
      fb.close();
    });

    await test('XML files (browser XML viewer) get the overlay', async () => {
      await openTab('xml', `${base}/data.xml`);
      const x = await attach('/data.xml');
      await x.send('Page.bringToFront');
      await openOn('xml', x);
      await press(x, 'Escape');
      x.close();
    });

    await test('non-HTML documents (raw SVG) use the fallback window', async () => {
      await openTab('svg', `${base}/img.svg`);
      await toggle('svg');
      await waitFor(fallbackTarget, { message: 'fallback window' });
      await swEval(`await closeFallbackWindow()`);
    });

    sw.close();
  } finally {
    cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
