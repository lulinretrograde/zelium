/**
 * Injected on demand (activeTab) into the current page. Mounts the palette in
 * a closed shadow root so page CSS can't affect it and vice versa, and puts
 * it in the top layer (popover) so it sits above page modals.
 *
 * Runs once per page; later shortcut presses arrive as "zelium:toggle".
 */
(() => {
  const Z = globalThis.Zelium;
  const TAG = 'zelium-palette';

  // Raw XML/SVG documents, or documents without a root, can't host the overlay:
  // hand over to the fallback window instead.
  if (!(document.documentElement instanceof HTMLElement) || typeof Element.prototype.attachShadow !== 'function') {
    chrome.runtime.sendMessage({ type: 'zelium:openPalette', forceFallback: true });
    return;
  }

  // Remove a stale host left behind by a previous (reloaded/updated) extension instance.
  document.querySelectorAll(TAG).forEach((el) => el.remove());

  const host = document.createElementNS('http://www.w3.org/1999/xhtml', TAG);
  host.style.cssText = [
    'all: initial !important',
    'position: fixed !important',
    'inset: 0 !important',
    'width: 100vw !important',
    'height: 100vh !important',
    'max-width: none !important',
    'max-height: none !important',
    'margin: 0 !important',
    'padding: 0 !important',
    'border: 0 !important',
    'background: transparent !important',
    'overflow: visible !important',
    'z-index: 2147483647 !important',
    'display: block !important',
  ].join(';');
  const supportsPopover = typeof host.showPopover === 'function';
  if (supportsPopover) host.setAttribute('popover', 'manual');

  const shadow = host.attachShadow({ mode: 'closed' });

  // Keep keystrokes inside the palette from reaching page shortcut handlers.
  for (const type of ['keydown', 'keyup', 'keypress', 'input', 'beforeinput', 'paste', 'copy', 'cut']) {
    host.addEventListener(type, (e) => e.stopPropagation());
  }

  let palette = null;
  let styled = null;
  let previousFocus = null;
  let visible = false;

  function ensureStyles() {
    styled ??= fetch(chrome.runtime.getURL('palette/palette.css'))
      .then((r) => r.text())
      .then((css) => {
        const sheet = new CSSStyleSheet();
        sheet.replaceSync(css);
        shadow.adoptedStyleSheets = [sheet];
      });
    return styled;
  }

  async function show() {
    if (visible) return;
    visible = true;
    await ensureStyles();
    palette ??= new Z.Palette({ root: shadow, onClose: hide });
    previousFocus = document.activeElement;
    document.documentElement.appendChild(host);
    if (supportsPopover) {
      try {
        host.showPopover();
      } catch {
        /* fall back to z-index */
      }
    }
    palette.open();
  }

  function hide() {
    if (!visible) return;
    visible = false;
    if (palette?.isOpen) palette.close(); // close() calls back into hide(); guarded by `visible`
    if (supportsPopover) {
      try {
        host.hidePopover();
      } catch {
        /* not open */
      }
    }
    host.remove();
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  // Test hook. Lives only in the extension's isolated world, never visible to the page.
  Z.instance = {
    get palette() {
      return palette;
    },
    get visible() {
      return visible;
    },
  };

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'zelium:toggle') return false;
    if (visible) hide();
    else show();
    sendResponse({ ok: true });
    return false;
  });

  show();
})();
