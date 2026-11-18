/**
 * Injected on demand (activeTab) into the current page. Mounts the overlay: a
 * closed shadow root in the top layer (popover), holding an iframe with the
 * palette (frame.html).
 *
 * The palette runs inside that extension-origin iframe, not in the page, so
 * the page can't read what you type (not even with capture-phase listeners),
 * restyle the UI, or see your tabs, bookmarks and history.
 *
 * Runs once per page; later shortcut presses arrive as "zelium:toggle".
 */
(() => {
  const TAG = 'zelium-palette';
  const XHTML = 'http://www.w3.org/1999/xhtml';
  const READY_TIMEOUT = 2500;

  const useFallback = () => chrome.runtime.sendMessage({ type: 'zelium:openPalette', forceFallback: true });

  // Raw XML/SVG documents, or documents without a root, can't host the overlay:
  // hand over to the fallback window instead.
  if (!(document.documentElement instanceof HTMLElement) || typeof Element.prototype.attachShadow !== 'function') {
    useFallback();
    return;
  }

  // Remove a stale host left behind by a previous (reloaded/updated) extension instance.
  document.querySelectorAll(TAG).forEach((el) => el.remove());

  let host = null;
  let frame = null;
  let port = null;
  let ready = false;
  let visible = false;
  let readyTimer = null;
  let previousFocus = null;

  /** Build the host + iframe + channel. Again later if the page removed the host. */
  function build() {
    host = document.createElementNS(XHTML, TAG);
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
    if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
    const shadow = host.attachShadow({ mode: 'closed' });

    const nonce = crypto.randomUUID();
    frame = document.createElementNS(XHTML, 'iframe');
    frame.src = `${chrome.runtime.getURL('frame.html')}#${nonce}`;
    frame.setAttribute('allow', 'clipboard-write');
    frame.setAttribute('title', 'Zelium');
    frame.style.cssText =
      'all: initial; display: block; position: fixed; inset: 0; width: 100%; height: 100%; border: 0; ' +
      'background: transparent; color-scheme: normal; visibility: hidden;';
    shadow.append(frame);

    const channel = new MessageChannel();
    port = channel.port1;
    ready = false;
    port.onmessage = ({ data }) => {
      if (data?.type === 'ready') {
        ready = true;
        clearTimeout(readyTimer);
        if (visible) reveal();
      } else if (data?.type === 'close') {
        hide();
      }
    };
    const origin = new URL(frame.src).origin;
    frame.addEventListener(
      'load',
      () => frame.contentWindow?.postMessage({ type: 'zelium:port', nonce }, origin, [channel.port2]),
      { once: true },
    );
  }

  function setShown(shown) {
    host.style.setProperty('display', shown ? 'block' : 'none', 'important');
    if (typeof host.showPopover !== 'function') return;
    try {
      if (shown) host.showPopover();
      else host.hidePopover();
    } catch {
      /* already in that state; z-index still applies */
    }
  }

  function reveal() {
    frame.style.visibility = 'visible';
    frame.focus();
    port.postMessage({ type: 'open' });
  }

  function show() {
    if (visible) return;
    visible = true;
    previousFocus = document.activeElement;
    if (!host?.isConnected) {
      // First use, or the page threw our host away (which also kills the iframe).
      host?.remove();
      build();
      document.documentElement.appendChild(host);
    }
    setShown(true);
    if (ready) {
      reveal();
      return;
    }
    // The frame never answered (blocked by the browser or the page): use the window instead.
    clearTimeout(readyTimer);
    readyTimer = setTimeout(() => {
      if (ready || !visible) return;
      hide();
      host.remove();
      useFallback();
    }, READY_TIMEOUT);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    clearTimeout(readyTimer);
    if (ready) port.postMessage({ type: 'close' }); // no-op if the palette closed itself
    frame.style.visibility = 'hidden';
    setShown(false);
    if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === 'function') {
      previousFocus.focus({ preventScroll: true });
    }
    previousFocus = null;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type !== 'zelium:toggle') return false;
    if (visible) hide();
    else show();
    sendResponse({ ok: true });
    return false;
  });

  show();
})();
