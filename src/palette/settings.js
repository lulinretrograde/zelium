/**
 * User settings, stored in chrome.storage.sync (follows the browser profile).
 * The palette (frame, fallback window) and the options page read them through here.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  const SECTIONS = ['tabs', 'bookmarks', 'history', 'commands'];
  const THEMES = ['dark', 'light', 'system'];

  /**
   * Opt-in AI services that open a new chat with the message in the URL
   * (`?q=`), so Zelium needs no access to the site.
   */
  const AI_PRESETS = [
    { id: 'perplexity', name: 'Perplexity', alias: 'perplexity', url: 'https://www.perplexity.ai/search?q=%s' },
    { id: 'grok', name: 'Grok', alias: 'grok', url: 'https://grok.com/?q=%s' },
    { id: 'lechat', name: 'Le Chat', alias: 'lechat', url: 'https://chat.mistral.ai/chat?q=%s' },
  ];

  const DEFAULTS = {
    /** Rank results you picked before for a query higher (kept locally only). */
    learn: true,
    /** Sent by "Ask … About This Page" when you don't type a message. */
    pagePrompt: 'Summarize this page.',
    theme: 'dark',
    /** Sections of the main search, and how many results each shows. */
    sections: { tabs: true, bookmarks: true, history: true, commands: true },
    limits: { tabs: 6, bookmarks: 5, history: 8, commands: 3 },
    /** A bang trigger ("ddg") for the web search row; '' = the browser's default engine. */
    defaultBang: '',
    /** Your own bangs, checked before Helium's: [{ trigger, name, url (with %s) }]. */
    customBangs: [],
    /** Enabled AI_PRESETS ids. */
    aiPresets: [],
    /** Your own AI services: [{ alias, name, url (with %s) }]. */
    customAis: [],
  };

  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const TRIGGER = /^[a-z0-9][a-z0-9._-]{0,30}$/i;
  const ALIAS = /^[a-z]{2,20}$/i;

  /** An https/http URL template containing %s, or ''. */
  function urlTemplate(v) {
    const s = str(v, 2000);
    if (!s.includes('%s')) return '';
    try {
      const u = new URL(s.replaceAll('%s', 'x'));
      return /^https?:$/.test(u.protocol) ? s : '';
    } catch {
      return '';
    }
  }

  function bangEntry(v) {
    if (!isObj(v)) return null;
    const trigger = str(v.trigger, 31).replace(/^!/, '').toLowerCase();
    const url = urlTemplate(v.url);
    if (!TRIGGER.test(trigger) || !url) return null;
    return { trigger, name: str(v.name, 60) || trigger, url };
  }

  function aiEntry(v) {
    if (!isObj(v)) return null;
    const alias = str(v.alias, 20).toLowerCase();
    const url = urlTemplate(v.url);
    if (!ALIAS.test(alias) || !url) return null;
    return { alias, name: str(v.name, 40) || alias, url };
  }

  /** Defaults merged with what's stored; unknown keys, wrong types and invalid entries are dropped. */
  function normalize(stored) {
    const out = structuredClone(DEFAULTS);
    if (!isObj(stored)) return out;
    if (typeof stored.learn === 'boolean') out.learn = stored.learn;
    if (str(stored.pagePrompt, 500)) out.pagePrompt = str(stored.pagePrompt, 500);
    if (THEMES.includes(stored.theme)) out.theme = stored.theme;
    for (const s of SECTIONS) {
      if (typeof stored.sections?.[s] === 'boolean') out.sections[s] = stored.sections[s];
      const n = stored.limits?.[s];
      if (Number.isInteger(n) && n >= 1 && n <= 20) out.limits[s] = n;
    }
    out.defaultBang = TRIGGER.test(str(stored.defaultBang).replace(/^!/, '')) ? str(stored.defaultBang).replace(/^!/, '').toLowerCase() : '';
    const uniq = (list, key) => list.filter((e, i) => e && list.findIndex((o) => o?.[key] === e[key]) === i);
    if (Array.isArray(stored.customBangs)) out.customBangs = uniq(stored.customBangs.slice(0, 200).map(bangEntry), 'trigger');
    if (Array.isArray(stored.aiPresets)) out.aiPresets = AI_PRESETS.map((p) => p.id).filter((id) => stored.aiPresets.includes(id));
    if (Array.isArray(stored.customAis)) out.customAis = uniq(stored.customAis.slice(0, 20).map(aiEntry), 'alias');
    return out;
  }

  /** The opt-in AI services that are switched on, presets first. */
  function extraAis(settings) {
    const presets = AI_PRESETS.filter((p) => settings.aiPresets.includes(p.id));
    return [...presets, ...settings.customAis];
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

  Z.settings = { DEFAULTS, AI_PRESETS, SECTIONS, THEMES, normalize, extraAis, urlTemplate, load, save };
})();
