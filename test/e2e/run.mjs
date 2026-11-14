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
import { listTargets, connect, sleep, waitFor, press } from './cdp.mjs';

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
      document.addEventListener('keydown', () => window.__keys++);
    </script>`,
  '/b.html': `<!doctype html><title>Beta Docs</title><h1>Beta</h1>`,
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
    `${base}/a.html`,
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
    const swTarget = () =>
      findTarget((t) => t.type === 'service_worker' && t.url.startsWith('chrome-extension://') && t.url.endsWith('/background.js'));

    let sw;
    let extId;
    await test('extension loads (service worker running)', async () => {
      const t = await waitFor(swTarget, { timeout: 15000, message: 'Zelium service worker' });
      extId = new URL(t.url).host;
      sw = connect(t.webSocketDebuggerUrl);
      const name = await sw.evaluate('chrome.runtime.getManifest().name');
      assert(name === 'Zelium', `unexpected extension ${name}`);
    });
    if (!sw) throw new Error('Extension did not load; aborting.');

    const swEval = (expr) => sw.evaluate(`(async () => { ${expr} })()`);
    const tabByUrl = (suffix) => swEval(`return (await chrome.tabs.query({})).find(t => (t.url || t.pendingUrl || '').endsWith(${JSON.stringify(suffix)}))`);
    const toggle = (suffix) =>
      swEval(`const t = (await chrome.tabs.query({})).find(t => (t.url || '').endsWith(${JSON.stringify(suffix)}));
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
      page.close();
    });

    // Attach to page A with a listener for the extension's isolated world.
    async function attach(suffix) {
      const t = await waitFor(() => findTarget((t) => t.type === 'page' && t.url.endsWith(suffix)), { message: `tab ${suffix}` });
      const page = connect(t.webSocketDebuggerUrl);
      const contexts = [];
      page.on('Runtime.executionContextCreated', ({ context }) => contexts.push(context));
      page.on('Runtime.executionContextsCleared', () => (contexts.length = 0));
      await page.send('Runtime.enable');
      page.isolated = async (expr) => {
        const ctx = await waitFor(() => [...contexts].reverse().find((c) => c.origin === `chrome-extension://${extId}` || c.name === 'Zelium'), {
          message: 'extension isolated world',
        });
        return page.evaluate(expr, ctx.id);
      };
      page.palette = (expr) => page.isolated(`(() => { const p = Zelium.instance.palette; return ${expr}; })()`);
      return page;
    }

    let a;
    await test('overlay opens on a page with hostile CSS', async () => {
      await toggle('/a.html');
      a = await attach('/a.html');
      await a.send('Page.bringToFront');
      await waitFor(() => a.palette('p && p.isOpen'), { message: 'palette open' });
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
      await swEval(`await chrome.tabs.create({ url: ${JSON.stringify(`${base}/b.html`)}, active: false })`);
      await waitFor(() => tabByUrl('/b.html').then((t) => t?.status === 'complete'), { message: 'tab b loaded' });
      // Re-open so the snapshot includes tab B.
      await press(a, 'Escape');
      await toggle('/a.html');
      await waitFor(() => a.palette('p.isOpen && p.snapshot.tabs.length >= 2'), { message: 'snapshot' });
      await a.send('Input.insertText', { text: 'beta dcs' });
      const first = await waitFor(() => a.palette(`p.rows[0] && p.rows[0].title`), { message: 'results' });
      assert(first === 'Beta Docs', `first result was ${first}`);
    });

    await test('keystrokes do not leak to the page', async () => {
      await press(a, 'ArrowDown');
      await press(a, 'ArrowUp');
      const leaked = await a.evaluate('window.__keys');
      assert(leaked === 0, `page saw ${leaked} keydown events`);
    });

    await test('Enter switches to the selected tab', async () => {
      await press(a, 'Enter');
      await waitFor(async () => (await swEval(`return (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.url`))?.endsWith('/b.html'), {
        message: 'tab B active',
      });
    });

    await test('calculator row', async () => {
      await toggle('/a.html');
      await waitFor(() => a.palette('p.isOpen'), { message: 'open' });
      await a.send('Input.insertText', { text: '2*(3+4)^2' });
      const row = await waitFor(() => a.palette(`p.rows[0]`), { message: 'calc row' });
      assert(row.kind === 'calc' && row.title === '= 98', `got ${JSON.stringify(row.title)}`);
      await press(a, 'Escape');
    });

    await test('> command mode runs a command (Pin Tab)', async () => {
      await toggle('/a.html');
      await waitFor(() => a.palette('p.isOpen'), { message: 'open' });
      await a.send('Input.insertText', { text: '>pin tab' });
      const mode = await a.palette('p.mode');
      assert(mode === 'commands', `mode is ${mode}`);
      await waitFor(() => a.palette(`p.rows[0]?.data?.id === 'tab.togglePin'`), { message: 'Pin Tab row' });
      await press(a, 'Enter');
      await waitFor(() => tabByUrl('/a.html').then((t) => t.pinned), { message: 'tab pinned' });
      await swEval(`const t = (await chrome.tabs.query({ pinned: true }))[0]; await chrome.tabs.update(t.id, { pinned: false });`);
    });

    await test('!bang builds a site search URL', async () => {
      await toggle('/a.html');
      await waitFor(() => a.palette('p.isOpen'), { message: 'open' });
      await a.send('Input.insertText', { text: '!yt lofi' });
      const url = await waitFor(() => a.palette(`p.rows[0]?.url`), { message: 'bang row' });
      assert(url === 'https://www.youtube.com/results?search_query=lofi', url);
    });

    await test('Escape closes and removes the overlay', async () => {
      await press(a, 'Escape');
      await waitFor(async () => !(await a.evaluate(`!!document.querySelector('zelium-palette')`)), { message: 'host removed' });
    });

    await test('layout stays left-to-right on RTL pages', async () => {
      await swEval(`await chrome.tabs.create({ url: ${JSON.stringify(`${base}/rtl.html`)} })`);
      await waitFor(() => tabByUrl('/rtl.html').then((t) => t?.status === 'complete'), { message: 'rtl loaded' });
      await toggle('/rtl.html');
      const r = await attach('/rtl.html');
      await waitFor(() => r.palette('p && p.isOpen'), { message: 'open' });
      const dir = await r.palette(`getComputedStyle(p.wrap).direction`);
      assert(dir === 'ltr', `direction ${dir}`);
      await press(r, 'Escape');
      r.close();
    });

    const fallbackTarget = () => findTarget((t) => t.type === 'page' && t.url.includes('/fallback.html'));

    await test('fallback window on browser-internal pages', async () => {
      await swEval(`await chrome.tabs.create({ url: 'chrome://version' })`);
      await sleep(500);
      await toggle('chrome://version/');
      const t = await waitFor(fallbackTarget, { message: 'fallback window' });
      const fb = connect(t.webSocketDebuggerUrl);
      const n = await waitFor(() => fb.evaluate(`document.querySelectorAll('.z-row').length`), { message: 'fallback rows' });
      assert(n > 0, 'fallback shows no rows');
      const popup = await swEval(`return (await chrome.windows.getAll()).filter(w => w.type === 'popup').length`);
      assert(popup === 1, `expected 1 popup window, got ${popup}`);
      // Pressing the shortcut again closes it.
      await toggle('chrome://version/');
      await waitFor(async () => !(await fallbackTarget()), { message: 'fallback closed' });
      fb.close();
    });

    await test('XML files (browser XML viewer) get the overlay', async () => {
      await swEval(`await chrome.tabs.create({ url: ${JSON.stringify(`${base}/data.xml`)} })`);
      await waitFor(() => tabByUrl('/data.xml').then((t) => t?.status === 'complete'), { message: 'xml loaded' });
      await toggle('/data.xml');
      const x = await attach('/data.xml');
      await waitFor(() => x.palette('p && p.isOpen'), { message: 'overlay open' });
      await press(x, 'Escape');
      x.close();
    });

    await test('non-HTML documents (raw SVG) use the fallback window', async () => {
      await swEval(`await chrome.tabs.create({ url: ${JSON.stringify(`${base}/img.svg`)} })`);
      await waitFor(() => tabByUrl('/img.svg').then((t) => t?.status === 'complete'), { message: 'svg loaded' });
      await toggle('/img.svg');
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
