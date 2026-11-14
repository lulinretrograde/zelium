# Changelog

## 0.2.0 — 2026-11-14

Cross-browser and cross-OS hardening.

- Works in any Chromium browser ≥ 102 (Chrome, Edge, Brave, Vivaldi, Opera, Arc, Helium, …) on
  macOS, Windows, Linux and ChromeOS.
- Any non-web page (`edge://`, `opera://`, `vivaldi://`, `arc://`, …) uses the fallback window;
  Edge and Opera add-on stores are recognised; the fallback opens as a tab if popups are unavailable.
- Welcome / options page: shows the actual shortcut, warns when it's unassigned, links to the
  browser's shortcut settings, and has a "Try it" button. The toolbar tooltip shows the real shortcut.
- Fallbacks for older builds and forks: own most-recently-used tab tracking, vector icons when the
  favicon service is missing, and DuckDuckGo when `chrome.search` is missing or broken.
- Correct rendering in XML documents (browser XML viewer); raw SVG and other non-HTML documents get
  the fallback window.
- Layout stays left-to-right on RTL pages; OS-specific monospace font stack.
- Platform-correct key hints (⌘ on macOS, Ctrl elsewhere); "New Private Window" naming.
- Real-browser end-to-end test suite, run in CI on Linux, Windows and macOS.

## 0.1.0 — 2026-11-14

First release.

- Centred command palette, opened with ⌘K / Ctrl+K (rebindable).
- Unified fuzzy search over open tabs, bookmarks, history and recently closed tabs.
- Prefix modes: `@` tabs, `#` bookmarks, `/` history, `>` commands.
- `!bang` site searches (`!yt`, `!gh`, `!w`, …) — prefix or suffix.
- Inline calculator and direct URL opening.
- 27 commands: tab/window management, copy URL/title/Markdown link, zoom, sort by domain, close duplicates, …
- Web search uses the browser's default search engine.
- Fallback popup window on pages extensions can't script (chrome://, new tab, Web Store).
- Zed One Dark theme: sharp corners, flat surfaces, monospace type.
