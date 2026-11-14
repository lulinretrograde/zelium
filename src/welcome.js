(() => {
  const IS_MAC = /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '');
  const $ = (id) => document.getElementById(id);

  $('version').textContent = `v${chrome.runtime.getManifest().version}`;

  // Platform-specific key labels.
  for (const el of document.querySelectorAll('[data-mod]')) el.textContent = IS_MAC ? '⌘' : 'Ctrl';
  const remove = $('remove-keys');
  for (const k of IS_MAC ? ['⌘', '⌫'] : ['Ctrl', '⇧', '⌫']) {
    const kbd = document.createElement('kbd');
    kbd.textContent = k;
    remove.append(kbd);
  }

  // Which browser is this? (Only used for display.)
  const brands = (navigator.userAgentData?.brands || []).map((b) => b.brand).filter((b) => !/not.?a.?brand/i.test(b));
  const browser = brands.find((b) => b !== 'Chromium') || brands[0] || 'Chromium';
  const os = navigator.userAgentData?.platform || navigator.platform || '';
  $('browser').textContent = `${browser} on ${os}`;

  async function refresh() {
    const res = await chrome.runtime.sendMessage({ type: 'zelium:shortcut' });
    const shortcut = res?.data || '';
    $('shortcut').textContent = shortcut || 'not set';
    $('unassigned').hidden = !!shortcut;
  }

  $('change').addEventListener('click', () => {
    // Every Chromium browser maps chrome:// to its own scheme (edge://, brave://, opera://…).
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  $('try').addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'zelium:openPalette' });
  });

  // Re-check when the user comes back from the shortcuts page.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && refresh());
  refresh();
})();
