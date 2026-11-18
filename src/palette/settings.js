/**
 * User settings, stored in chrome.storage.sync (follows the browser profile).
 * Pages that show the palette and the options page read them through here.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  const DEFAULTS = {
    /** Rank results you picked before for a query higher (kept locally only). */
    learn: true,
  };

  /** Defaults merged with what's stored, ignoring unknown keys and wrong types. */
  function normalize(stored) {
    const out = structuredClone(DEFAULTS);
    if (!stored || typeof stored !== 'object') return out;
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (typeof stored[k] === typeof v) out[k] = stored[k];
    }
    return out;
  }

  async function load() {
    try {
      const { settings } = await chrome.storage.sync.get('settings');
      return normalize(settings);
    } catch {
      return normalize(null);
    }
  }

  async function save(patch) {
    const next = normalize({ ...(await load()), ...patch });
    await chrome.storage.sync.set({ settings: next });
    return next;
  }

  Z.settings = { DEFAULTS, normalize, load, save };
})();
