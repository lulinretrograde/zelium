/**
 * Fallback popup window, used on pages extensions cannot script
 * (chrome:// pages, the new tab page, the Web Store, PDFs…).
 * The opener tab id comes in via ?tab=<id> so actions target that tab.
 */
(() => {
  const params = new URLSearchParams(location.search);
  const tabId = Number(params.get('tab'));

  const palette = new Zelium.Palette({
    root: document.getElementById('app'),
    embedded: true,
    fallback: true,
    contextTabId: Number.isInteger(tabId) && tabId > 0 ? tabId : undefined,
    onClose: () => window.close(),
  });

  palette.open();

  // Clicking back into the browser dismisses the palette, like the overlay.
  window.addEventListener('blur', () => {
    if (palette.isOpen) window.close();
  });
})();
