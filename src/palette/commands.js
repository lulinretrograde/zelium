/**
 * Command definitions shown in ">" mode.
 *  - `local: true` commands run in the palette (clipboard); the rest are sent
 *    to the background worker by id.
 *  - `title` may be a function of the current tab for toggles.
 */
(() => {
  const Z = (globalThis.Zelium ??= {});

  const COMMANDS = [
    { id: 'copy.url', title: 'Copy URL', keywords: 'link address clipboard', icon: 'copy', local: true, group: 'Copy' },
    { id: 'copy.markdown', title: 'Copy as Markdown Link', keywords: 'md link clipboard', icon: 'markdown', local: true, group: 'Copy' },
    { id: 'copy.title', title: 'Copy Page Title', keywords: 'name clipboard', icon: 'text', local: true, group: 'Copy' },

    { id: 'tab.new', title: 'New Tab', keywords: 'open create', icon: 'plus', group: 'Tab' },
    { id: 'tab.close', title: 'Close Tab', keywords: 'remove kill', icon: 'close', group: 'Tab' },
    { id: 'tab.closeOthers', title: 'Close Other Tabs', keywords: 'remove only keep', icon: 'closeOthers', group: 'Tab' },
    { id: 'tab.closeRight', title: 'Close Tabs to the Right', keywords: 'remove', icon: 'closeRight', group: 'Tab' },
    { id: 'tab.closeDuplicates', title: 'Close Duplicate Tabs', keywords: 'dedupe dupes clean', icon: 'dupes', group: 'Tab' },
    { id: 'tab.duplicate', title: 'Duplicate Tab', keywords: 'clone copy', icon: 'copy', group: 'Tab' },
    { id: 'tab.togglePin', title: (t) => (t?.pinned ? 'Unpin Tab' : 'Pin Tab'), keywords: 'pin unpin', icon: 'pin', group: 'Tab' },
    { id: 'tab.toggleMute', title: (t) => (t?.muted ? 'Unmute Tab' : 'Mute Tab'), keywords: 'sound audio silence', icon: (t) => (t?.muted ? 'volume' : 'mute'), group: 'Tab' },
    { id: 'tab.reload', title: 'Reload Tab', keywords: 'refresh', icon: 'reload', group: 'Tab' },
    { id: 'tab.hardReload', title: 'Hard Reload Tab', keywords: 'refresh bypass cache', icon: 'reload', group: 'Tab' },
    { id: 'tab.toWindow', title: 'Move Tab to New Window', keywords: 'detach pop out', icon: 'moveWindow', group: 'Tab' },
    { id: 'tab.sortByDomain', title: 'Sort Tabs by Domain', keywords: 'organize order arrange', icon: 'sort', group: 'Tab' },
    { id: 'session.reopen', title: 'Reopen Closed Tab', keywords: 'undo restore', icon: 'restore', group: 'Tab' },

    { id: 'window.new', title: 'New Window', keywords: 'open', icon: 'window', group: 'Window' },
    { id: 'window.incognito', title: 'New Incognito Window', keywords: 'private', icon: 'incognito', group: 'Window' },

    { id: 'zoom.in', title: 'Zoom In', keywords: 'bigger larger', icon: 'zoomIn', group: 'View' },
    { id: 'zoom.out', title: 'Zoom Out', keywords: 'smaller', icon: 'zoomOut', group: 'View' },
    { id: 'zoom.reset', title: 'Reset Zoom', keywords: 'actual size 100', icon: 'zoomReset', group: 'View' },

    { id: 'page.history', title: 'Open History', keywords: 'chrome page', icon: 'history', group: 'Open' },
    { id: 'page.downloads', title: 'Open Downloads', keywords: 'chrome page files', icon: 'download', group: 'Open' },
    { id: 'page.bookmarks', title: 'Open Bookmark Manager', keywords: 'chrome page', icon: 'bookmark', group: 'Open' },
    { id: 'page.extensions', title: 'Open Extensions', keywords: 'chrome page addons plugins', icon: 'grid', group: 'Open' },
    { id: 'page.settings', title: 'Open Settings', keywords: 'chrome page preferences', icon: 'settings', group: 'Open' },
    { id: 'page.shortcuts', title: 'Change Zelium Shortcut', keywords: 'keyboard hotkey keybinding', icon: 'keyboard', group: 'Open' },
  ];

  const resolve = (v, tab) => (typeof v === 'function' ? v(tab) : v);

  /** Commands with titles/icons resolved for the current tab. */
  function list(currentTab) {
    return COMMANDS.map((c) => ({ ...c, title: resolve(c.title, currentTab), icon: resolve(c.icon, currentTab) }));
  }

  Z.commands = { COMMANDS, list };
})();
