# Changelog

## Unreleased

- **Private overlay:** the palette now runs in an extension iframe inside the page overlay. Pages
  could previously read what you typed into it with a capture-phase key listener; now they can't
  see your keystrokes, the UI or your tabs/bookmarks/history. `frame.html` is the only file pages
  can load from the extension.
- **Asking an AI from the main search needs a colon:** `claude: <message>`. Searches like
  "claude code docs" stay searches. In `>` mode the colon is optional.
- Dates and phone numbers (`2026-11-18`, `10/12/2024`, `1-800-555-0100`) are no longer calculated.
- Errors from actions show in the overlay instead of the palette just closing. Bookmarklets are
  labelled and explain that they can't run from Zelium.
- `mailto:`/`tel:` links open directly; domains with unlisted TLDs work when they have a path or port.
- Pasting text that starts with `/`, `#` or `@` no longer switches modes.
- Fixed lost "recently used" tab updates when switching tabs quickly.

## 0.5.0 — 2026-11-14

- **Ask an AI from the palette:** `claude <message>`, `gpt <message>` (or `chatgpt`), `gemini …`,
  `deepseek …`, `kimi …` opens a new chat, types the message and sends it. <kbd>Tab</kbd> on a
  *New … Chat* command starts the message. <kbd>⇧↵</kbd> opens it in a new window.
- New host permissions for those five sites, used only to type into the chat Zelium just opened.

## 0.4.0 — 2026-11-14

- **New AI chat commands:** *New Claude Chat*, *New ChatGPT Chat*, *New Gemini Chat*,
  *New DeepSeek Chat* and *New Kimi Chat* open a fresh chat in a new tab (<kbd>⇧↵</kbd> for a new
  window). Find them with `>claude`, `>gpt`, or just type the name in the main search.

## 0.3.0 — 2026-11-14

- **Helium's bangs:** the full list Helium uses natively (Kagi bangs + Helium extras: 10,735 sites,
  13,438 triggers) replaces the 16 hand-picked bangs. Same triggers and URLs as Helium's address bar
  (`!w`, `!gh`, `!yt`, `!wd`, …).
- Prefix suggestions for any trigger (`!gh` → GitHub, GitHub Code, GitHub Docs, …), exact match first.
- `!w` + Enter (no query) opens the site itself.
- Honours each bang's format flags (e.g. the Wayback Machine gets the URL unencoded).
- AI bangs are labelled. The list loads lazily the first time `!` is typed; no network requests.
- `npm run bangs` refreshes the list from Helium's services.

## 0.2.0 — 2026-11-14

Cross-browser and cross-OS hardening.

- Default shortcut on Windows/Linux/ChromeOS is now **Alt+K**. Chromium refuses to assign Ctrl+K to
  extensions there (it's the browser's search shortcut), so the palette previously had no shortcut on
  those systems. macOS stays ⌘K.
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

- Centred command palette, opened with ⌘K (rebindable).
- Unified fuzzy search over open tabs, bookmarks, history and recently closed tabs.
- Prefix modes: `@` tabs, `#` bookmarks, `/` history, `>` commands.
- `!bang` site searches (`!yt`, `!gh`, `!w`, …) — prefix or suffix.
- Inline calculator and direct URL opening.
- 27 commands: tab/window management, copy URL/title/Markdown link, zoom, sort by domain, close duplicates, …
- Web search uses the browser's default search engine.
- Fallback popup window on pages extensions can't script (chrome://, new tab, Web Store).
- Zed One Dark theme: sharp corners, flat surfaces, monospace type.
