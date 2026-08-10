# AGENTS.md

This file is for coding agents and contributors working on the MultiSub HBO Max and Netflix extensions.

## Project Overview

This repository produces two independent Chrome Manifest V3 extensions that add a second official subtitle track to HBO Max or Netflix. They do not generate, translate, or fetch external subtitles. Each package only uses tracks exposed by its active playback session.

Each extension has three runtime surfaces:

- `content.ts`: isolated-world UI, storage, overlay, menu, and debug behavior.
- `page-hook.ts`: main/page-world official-track discovery and selected-track loading.
- `popup.ts`: the independently packaged toolbar popup.

The HBO page hook captures DASH `.mpd` manifests. The Netflix page hook starts directly in `world: "MAIN"`, caches visible manifests by `movieId`, and falls back to the active Netflix player session when licensed manifest contents are not visible.

## Project Structure

```text
public/
  ...                 HBO static extension files

netflix-public/
  ...                 Netflix static extension files

src/
  content.ts          HBO content script
  page-hook.ts        HBO page hook
  mpd.ts              DASH manifest subtitle track extraction
  vtt.ts              WebVTT cue parsing and segmented timing normalization
  timeline.ts         Manifest/video timeline offset helpers
  settings.ts         Popup and runtime settings model
  popup.ts            Toolbar popup behavior
  messages.ts         Page/content message contracts

  netflix/
    content.ts        Netflix isolated-world UI and overlays
    page-hook.ts      Netflix MAIN-world player/manifest integration
    popup.ts          Netflix popup behavior
    messages.ts       Netflix-specific bridge contracts
    hydration.ts      Serialized temporary-track selection helpers
    menu-model.ts     Strict Netflix menu-root validation
    player-selection.ts Active `/watch/<movieId>` session selection
    track-model.ts    Netflix current/legacy track normalization
    ttml.ts           IMSC/TTML cue parsing
    settings.ts       Netflix storage keys and shared settings exports

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

GitHub Actions runs the same verification flow and uploads separate HBO and Netflix ZIP artifacts.

## Browser Testing

After `npm run build`:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load `dist/hbo` and/or `dist/netflix` as separate unpacked extensions.
4. After each rebuild, click Reload on the extension.
5. Refresh the playback tab so both scripts run from `document_start`.

Always mute the Netflix page before playback testing. Netflix may replace its `<video>` element during player startup, so confirm the replacement video is also muted before continuing.

## Runtime Behavior

- The native HBO or Netflix subtitle menu should continue to work.
- Each extension adds `Secondary Subtitles` as a third menu column beside the native audio and subtitle columns; Netflix also exposes track selection in its popup.
- The Netflix popup changes only the active tab. Storage changes update the preference used for future titles and must not immediately switch another open Netflix tab.
- The second subtitle selection is persisted and restored when a video opens.
- `Matched style` mode lets the extension render the primary subtitle too; native captions are hidden only after the matching official track is loaded.
- Plugin-rendered primary subtitles stay in the lower subtitle area.
- When both plugin-rendered subtitles are in the lower area, the primary subtitle is larger and above the second subtitle.
- The second subtitle can also be placed at the top.
- Overlay elements must be moved into the active fullscreen element so subtitles remain visible in fullscreen mode.
- Subtitle text must be rendered with `textContent`, not injected HTML.
- Only the selected second subtitle track should be loaded; avoid eager-loading every language.
- Netflix homepage hover preloads must never replace the manifest or cues for the active `/watch/<movieId>` title.
- Signed Netflix subtitle URLs are session data: do not store them or include them in debug snapshots/logs.
- Netflix image-based subtitle tracks are currently filtered out rather than shown as unusable options.

## Subtitle Timing Notes

HBO Max subtitle timing can involve MPD `presentationTime`, segment `mediaTime`, WebVTT cue timestamps, and `X-TIMESTAMP-MAP`. Keep parser changes covered by tests in `tests/vtt.test.ts`, `tests/mpd.test.ts`, and `tests/timeline.test.ts`.

Netflix text subtitles commonly use IMSC/TTML with `ttp:tickRate="10000000"`, but the parser also supports clock, frame, and offset times. Keep Netflix parser and alias changes covered by `tests/netflix-ttml.test.ts` and `tests/netflix-track-model.test.ts`.

Important expectations:

- Cue times are normalized to millisecond precision.
- Seeking should update overlays based on `video.currentTime`.
- Segment timing should remain stable across seek windows.
- CC and non-CC tracks may have similar labels but different cue text; do not collapse them unless the UI intentionally maps the native label to the matching track.

## Debugging Subtitle Sync

The content scripts write JSON snapshots at `#hbo-dual-sub-debug` and `#netflix-dual-sub-debug`.

In the playback page DevTools console:

```js
JSON.parse(document.querySelector('#hbo-dual-sub-debug').textContent)
JSON.parse(document.querySelector('#netflix-dual-sub-debug').textContent)
```

The snapshot includes current video time, native subtitle text, plugin subtitle text, selected tracks, active/nearby cues, available tracks, and manifest/video timeline metadata.

## Code Style

- Prefer existing local helpers and data types.
- Keep changes scoped to the extension behavior being modified.
- Add or update tests when changing MPD parsing, WebVTT/TTML parsing, timing logic, settings sanitization, Netflix aliases, or track matching.
- Keep README user-facing. Put development details in this file.
- Do not commit generated `dist` output.

## Git Notes

This workspace may need a temporary safe-directory flag when run from the Codex sandbox:

```bash
git -c safe.directory='C:/Users/zerol/Workspace/HBO Dual Sub' status
```
