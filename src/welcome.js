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

  // -------------------------------------------------------------------------
  // Settings (saved as you change them)
  // -------------------------------------------------------------------------

  const S = Zelium.settings;
  const form = $('settings');
  const field = (name) => form.elements.namedItem(name);

  /** "a | b | c" lines → objects; lines that don't validate are reported. */
  function parseLines(text, keys, validate) {
    const ok = [];
    const bad = [];
    text.split('\n').forEach((line, i) => {
      if (!line.trim()) return;
      const parts = line.split('|').map((s) => s.trim());
      // "trigger | URL" is fine too: the name defaults to the trigger.
      if (parts.length === 2) parts.splice(1, 0, '');
      const entry = Object.fromEntries(keys.map((k, j) => [k, parts[j] ?? '']));
      const valid = parts.length === 3 && validate(entry);
      if (valid) ok.push(valid);
      else bad.push(i + 1);
    });
    return { ok, bad };
  }
  const toLines = (list, keys) => list.map((e) => keys.map((k) => e[k]).join(' | ')).join('\n');
  const BANG_KEYS = ['trigger', 'name', 'url'];
  const AI_KEYS = ['alias', 'name', 'url'];
  const validBang = (e) => S.normalize({ customBangs: [e] }).customBangs[0];
  const validAi = (e) => S.normalize({ customAis: [e] }).customAis[0];

  function showErrors(id, bad) {
    const el = $(id);
    el.hidden = !bad.length;
    el.textContent = bad.length ? `Line${bad.length > 1 ? 's' : ''} ${bad.join(', ')} ignored: use “a | Name | https://…%s”.` : '';
  }

  // Opt-in AI presets.
  const presetsBox = $('ai-presets');
  for (const p of S.AI_PRESETS) {
    const label = document.createElement('label');
    label.className = 'check';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.name = 'aiPresets';
    box.value = p.id;
    const text = document.createElement('span');
    text.textContent = `${p.name} — type “${p.alias}: …”`;
    label.append(box, text);
    presetsBox.append(label);
  }

  function fill(s) {
    field('learn').checked = s.learn;
    field('pagePrompt').value = s.pagePrompt;
    field('theme').value = s.theme;
    for (const sec of S.SECTIONS) {
      field(`sections.${sec}`).checked = s.sections[sec];
      field(`limits.${sec}`).value = s.limits[sec];
    }
    field('defaultBang').value = s.defaultBang;
    field('customBangs').value = toLines(s.customBangs, BANG_KEYS);
    field('customAis').value = toLines(s.customAis, AI_KEYS);
    for (const box of form.querySelectorAll('input[name="aiPresets"]')) box.checked = s.aiPresets.includes(box.value);
    describeDefaultBang();
  }

  function read() {
    const bangs = parseLines(field('customBangs').value, BANG_KEYS, validBang);
    const ais = parseLines(field('customAis').value, AI_KEYS, validAi);
    showErrors('customBangs-errors', bangs.bad);
    showErrors('customAis-errors', ais.bad);
    return {
      learn: field('learn').checked,
      pagePrompt: field('pagePrompt').value,
      theme: field('theme').value,
      sections: Object.fromEntries(S.SECTIONS.map((sec) => [sec, field(`sections.${sec}`).checked])),
      limits: Object.fromEntries(S.SECTIONS.map((sec) => [sec, Number(field(`limits.${sec}`).value)])),
      defaultBang: field('defaultBang').value,
      customBangs: bangs.ok,
      aiPresets: [...form.querySelectorAll('input[name="aiPresets"]:checked')].map((b) => b.value),
      customAis: ais.ok,
    };
  }

  // Show what the default-bang trigger points to (needs the full bang list).
  let bangsLoaded = null;
  async function describeDefaultBang() {
    const info = $('defaultBang-info');
    const trigger = field('defaultBang').value.trim().replace(/^!/, '');
    if (!trigger) {
      info.textContent = "Empty: your browser's default engine. Or a bang trigger like ddg or kagi.";
      info.className = 'muted';
      return;
    }
    bangsLoaded ??= fetch(chrome.runtime.getURL('third_party/bangs/bangs.json'))
      .then((r) => r.json())
      .then((rows) => Zelium.parse.setBangs(rows))
      .catch(() => {});
    await bangsLoaded;
    Zelium.parse.setUserBangs(parseLines(field('customBangs').value, BANG_KEYS, validBang).ok);
    const bang = Zelium.parse.bangFor(trigger);
    info.textContent = bang ? `Searches ${bang.name} (${bang.host}).` : `No bang “!${trigger}”: the browser's default engine is used.`;
    info.className = bang ? 'muted' : 'warn';
  }

  let saveTimer;
  let savedTimer;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await S.save(read());
        $('saved').textContent = 'Saved';
      } catch (err) {
        $('saved').textContent = `Not saved: ${err.message}`;
      }
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
    }, 300);
  }

  form.addEventListener('input', (e) => {
    if (e.target.name === 'defaultBang' || e.target.name === 'customBangs') describeDefaultBang();
    scheduleSave();
  });
  form.addEventListener('change', scheduleSave);
  form.addEventListener('submit', (e) => e.preventDefault());

  $('clear-learned').addEventListener('click', async () => {
    await Zelium.learn.clear();
    $('saved').textContent = 'Cleared learned results';
  });

  S.load().then(fill);

  // Downloads: an optional permission.
  const DOWNLOADS = { permissions: ['downloads', 'downloads.open'] };
  async function refreshDownloads() {
    const on = await chrome.permissions.contains(DOWNLOADS).catch(() => false);
    $('downloads-status').textContent = on ? 'Allowed' : 'Not allowed';
    $('downloads-allow').hidden = on;
    $('downloads-revoke').hidden = !on;
  }
  $('downloads-allow').addEventListener('click', async () => {
    await chrome.permissions.request(DOWNLOADS).catch(() => false);
    refreshDownloads();
  });
  $('downloads-revoke').addEventListener('click', async () => {
    await chrome.permissions.remove(DOWNLOADS).catch(() => false);
    refreshDownloads();
  });
  chrome.permissions.onAdded?.addListener(refreshDownloads);
  chrome.permissions.onRemoved?.addListener(refreshDownloads);
  refreshDownloads();
})();
