# AGENTS.md

This file is for coding agents and contributors working on MultiSubs for HBO Max.

## Project Overview

MultiSubs for HBO Max is a Chrome Manifest V3 extension that adds a second official subtitle track to HBO Max. It does not generate, translate, or fetch external subtitles. It only uses subtitle tracks that HBO Max exposes for the currently playing title.

The extension has three runtime surfaces:

- `content.ts`: runs as the Chrome content script, injects the page hook, integrates with the HBO subtitles menu, renders subtitle overlays, manages settings, and publishes debug snapshots.
- `page-hook.ts`: runs in the page context, wraps `fetch` and `XMLHttpRequest`, captures DASH `.mpd` manifests, extracts subtitle tracks, and loads selected WebVTT segments.
- `popup.ts`: runs in the toolbar popup and updates stored display settings.

## Project Structure

```text
public/
  manifest.json       Chrome MV3 manifest
  popup.html          Toolbar popup UI
  popup.css           Popup styling
  styles.css          HBO page overlay/menu styles

src/
  content.ts          Content script, HBO menu integration, subtitle overlays
  page-hook.ts        Page-context fetch/XHR hook and subtitle loading
  mpd.ts              DASH manifest subtitle track extraction
  vtt.ts              WebVTT cue parsing and segmented timing normalization
  timeline.ts         Manifest/video timeline offset helpers
  settings.ts         Popup and runtime settings model
  popup.ts            Toolbar popup behavior
  messages.ts         Page/content message contracts

tests/
  *.test.ts           Parser, timeline, and settings tests

scripts/
  setup-node.sh       Project-local Node 22 installer for WSL/Linux
```

`dist/`, `node_modules/`, and `.tools/` are generated or local-only and are ignored by git.

## Development Environment

Recommended environment: WSL Ubuntu with the project-local Node 22 toolchain.

```bash
bash scripts/setup-node.sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm install
```

Common checks:

```bash
npm run typecheck
npm test
npm run build
```

The generated `dist` directory is used for unpacked-extension testing, but it should not be committed.

GitHub Actions runs the same verification flow in `.github/workflows/build.yml` and uploads a zipped `dist` artifact.

## Browser Testing

After `npm run build`:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load the generated `dist` directory as an unpacked extension.
4. After each rebuild, click Reload on the extension.
5. Refresh the HBO Max playback tab so `content.js` and `page-hook.js` run from `document_start`.

## Runtime Behavior

- The native HBO subtitle menu should continue to work.
- The extension adds a `Secondary Subtitles` section below HBO's subtitle options.
- The second subtitle selection is persisted and restored when a video opens.
- `Matched style` mode lets the extension render the primary subtitle too; the native HBO caption DOM is hidden only after the matching official track is loaded.
- Plugin-rendered primary subtitles always stay at the bottom.
- The second subtitle can be placed at the top or in the lower subtitle area.
- Subtitle text must be rendered with `textContent`, not injected HTML.
- Only the selected second subtitle track should be loaded; avoid eager-loading every language.

## Subtitle Timing Notes

HBO Max subtitle timing can involve MPD `presentationTime`, segment `mediaTime`, WebVTT cue timestamps, and `X-TIMESTAMP-MAP`. Keep parser changes covered by tests in `tests/vtt.test.ts`, `tests/mpd.test.ts`, and `tests/timeline.test.ts`.

Important expectations:

- Cue times are normalized to millisecond precision.
- Seeking should update overlays based on `video.currentTime`.
- Segment timing should remain stable across seek windows.
- CC and non-CC tracks may have similar labels but different cue text; do not collapse them unless the UI intentionally maps the native label to the matching track.

## Debugging Subtitle Sync

The content script writes a JSON snapshot into the page at `#hbo-dual-sub-debug`.

In the HBO Max page DevTools console:

```js
JSON.parse(document.querySelector('#hbo-dual-sub-debug').textContent)
```

The snapshot includes current video time, native subtitle text, plugin subtitle text, selected tracks, active/nearby cues, available tracks, and manifest/video timeline metadata.

## Code Style

- Prefer existing local helpers and data types.
- Keep changes scoped to the extension behavior being modified.
- Add or update tests when changing MPD parsing, WebVTT parsing, timing logic, settings sanitization, or track matching.
- Keep README user-facing. Put development details in this file.
- Do not commit generated `dist` output.

## Git Notes

This workspace may need a temporary safe-directory flag when run from the Codex sandbox:

```bash
git -c safe.directory='C:/Users/zerol/Workspace/HBO Dual Sub' status
```
