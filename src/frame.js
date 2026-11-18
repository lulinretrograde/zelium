/**
 * The palette inside the overlay iframe (frame.html), on normal pages.
 *
 * It runs on the extension's origin, so the page can't see its keystrokes, DOM
 * or data. content.js talks to it over a private MessageChannel, handed over
 * with a nonce from the frame's URL so the page can't pose as content.js.
 */
(() => {
  const nonce = location.hash.slice(1);
  let port = null;

  const palette = new Zelium.Palette({
    root: document.getElementById('app'),
    onClose: () => port?.postMessage({ type: 'close' }),
  });

  window.addEventListener('message', (e) => {
    if (port || !nonce || e.source !== window.parent || e.data?.type !== 'zelium:port' || e.data.nonce !== nonce) return;
    [port] = e.ports;
    if (!port) return;
    port.onmessage = ({ data }) => {
      if (data?.type === 'open') palette.open({ selection: typeof data.selection === 'string' ? data.selection : '' });
      else if (data?.type === 'close') palette.close();
    };
    port.postMessage({ type: 'ready' });
  });

  // Test hook (the extension's own page; never visible to the website).
  Zelium.instance = {
    get palette() {
      return palette;
    },
  };
})();
