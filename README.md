# Zelium

A Zed-style command palette for the [Helium](https://helium.computer) browser (and any Chromium browser).
Press **⌘K** and a sharp, dark palette opens in the middle of the screen. From one input you can search
your open tabs, bookmarks, history and recently closed tabs, run browser commands, do quick maths or
search the web.

![Zelium screenshot](docs/screenshot.png)

## Features

- **One box for everything.** Results are grouped as *Tabs → Bookmarks → History → Commands → Web*,
  using fuzzy matching with highlighted characters, like Zed's file finder.
- **Prefix modes** narrow the search:

  | Prefix | Mode |
  | --- | --- |
  | `@` | open tabs |
  | `#` | bookmarks |
  | `/` | history |
  | `>` | commands |

  <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> cycles between modes. <kbd>⌫</kbd> on an empty input goes back to *all*.
- **Bangs** search a site directly: `!yt lofi`, `serde !crates`, `!gh zed`. Type `!` to see the list
  (Google, DuckDuckGo, Brave, YouTube, GitHub, Wikipedia EN/DE, Reddit, Stack Overflow, MDN, npm,
  crates.io, Hacker News, OpenStreetMap, Amazon, DeepL).
- **Calculator:** `2*(3+4)`, `sqrt(2)^2`, `2*pi`. <kbd>↵</kbd> copies the result.
- **Direct URLs:** `github.com`, `localhost:3000`, `192.168.1.1` open straight away.
- **Web search** goes through **your browser's default search engine**.
- **Commands (`>`):**
  - copy URL, copy title, copy as a Markdown link
  - new, close, duplicate, pin or mute a tab; close other tabs, tabs to the right, or duplicates
  - reload or hard reload; move a tab to a new window; sort tabs by domain; reopen a closed tab
  - new window or incognito window; zoom in, out or reset
  - open History, Downloads, Bookmarks, Extensions, Settings or the shortcut settings
- **With an empty input** the palette shows your most recently used tabs and recently closed tabs.
- **Works everywhere.** On pages extensions can't touch (`chrome://`, the new tab page, the Web Store,
  PDFs), Zelium opens the same palette in a small centred popup window instead.
- **Private by design.** No network requests, no analytics, no dependencies. Everything stays local.

## Keys

| Key | Action |
| --- | --- |
| <kbd>⌘K</kbd> / <kbd>Ctrl+K</kbd> | open / close the palette |
| <kbd>↑</kbd> <kbd>↓</kbd> · <kbd>Ctrl+N</kbd> <kbd>Ctrl+P</kbd> · <kbd>Ctrl+J</kbd> <kbd>Ctrl+K</kbd> | move the selection |
| <kbd>PgUp</kbd> <kbd>PgDn</kbd> | jump 8 rows |
| <kbd>↵</kbd> | open / switch / run |
| <kbd>⌘↵</kbd> / <kbd>Ctrl+↵</kbd> | open in a new tab |
| <kbd>⇧↵</kbd> | open in a new window (or move the selected tab to one) |
| <kbd>⌘⌫</kbd> / <kbd>Ctrl+⇧+⌫</kbd> | close the selected tab, or remove the selected history entry |
| <kbd>⌘C</kbd> (no text selected) | copy the selected row's URL |
| <kbd>Tab</kbd> / <kbd>⇧Tab</kbd> | next / previous mode (or complete a `!bang`) |
| <kbd>Esc</kbd> | close |

Middle-click a row to open it in a new tab.

To change the shortcut, run `> Change Zelium Shortcut` or go to `chrome://extensions/shortcuts`.

## Install

Zelium isn't on a store yet, so load it unpacked:

1. Clone this repo.
2. In Helium, open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and pick the **`src/`** folder.
4. Press **⌘K** on any page.

If ⌘K does nothing, another extension may already use it. Set a key at `chrome://extensions/shortcuts`.

## How it works

```
src/
├── manifest.json        MV3 manifest
├── background.js        service worker: shortcut, data (tabs/bookmarks/history/sessions), actions
├── content.js           mounts the palette in a closed shadow root + top-layer popover
├── fallback.html/.js    popup window used on pages that can't be scripted
└── palette/
    ├── palette.js       UI: modes, ranking, rendering, keyboard handling
    ├── palette.css      Zed One Dark theme
    ├── fuzzy.js         fuzzy matcher (word-start / consecutive bonuses, highlight ranges)
    ├── parse.js         URL detection, calculator (no eval), !bangs, formatting helpers
    ├── commands.js      command definitions for ">" mode
    └── icons.js         inline 16px sharp-stroke SVG icons
```

- The palette is injected **on demand** through `activeTab` + `scripting`. Zelium doesn't run on
  pages until you press the shortcut, and it doesn't need "read all sites" host permissions.
- The UI lives in a **closed shadow root** with its own stylesheet, so pages can't restyle it. It also
  goes into the browser's **top layer** (Popover API), so it shows above page modals.
- History is loaded as a snapshot of the last 1000 visits for instant fuzzy matching, plus a
  debounced `chrome.history.search` per query to reach older entries.

### Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | inject the palette into the current tab when you press the shortcut |
| `tabs` | list and switch tabs, read titles/URLs |
| `history` | search history, remove entries (⌘⌫) |
| `bookmarks` | search bookmarks |
| `sessions` | recently closed tabs, reopen |
| `search` | search with your default engine |
| `favicon` | show site icons |
| `storage` | remember the fallback window between service-worker restarts |

## Development

No build step is needed. Edit the files in `src/`, then click the reload icon on Zelium in `chrome://extensions`.

```bash
npm test          # unit tests (fuzzy matcher, parser, calculator, bangs)
npm run check     # syntax-check all JS + verify manifest references
npm run build     # check + zip src/ into dist/zelium-<version>.zip
npm run icons     # regenerate src/icons/*.png
```

Requires Node ≥ 20 for the scripts. The extension itself has no dependencies.

## Theme

Colours follow Zed's **One Dark**:

| Token | Value |
| --- | --- |
| surface | `#2f343e` |
| background | `#282c33` |
| border | `#464b57` |
| text | `#dce0e5` |
| muted | `#878a98` |
| selection | `#454a56` |
| accent | `#74ade8` |

Corners are square, borders are 1px, and the type is monospace (`Zed Plex Mono` → `IBM Plex Mono` →
`JetBrains Mono` → `SF Mono` → …). Install one of these fonts for the most Zed-like look.

## License

MIT
