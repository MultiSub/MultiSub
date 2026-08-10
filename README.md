# MultiSub

Free and open-source dual-subtitle extensions for HBO Max and Netflix.

This repository builds two independent Chrome Manifest V3 extensions:

- **MultiSub for HBO Max** adds a second official subtitle track to HBO Max.
- **MultiSub for Netflix** adds a second official subtitle track to Netflix.

Each extension has its own manifest, storage, popup, content scripts, and build artifact. Neither extension generates or translates subtitles, searches external subtitle services, or unlocks tracks outside the active playback session.

## Features

- Displays two official subtitle tracks at once.
- Keeps the streaming service's native subtitle selector working.
- Presents the added selector as a third menu column beside native audio and subtitle choices.
- Loads only the selected second subtitle track.
- Remembers the preferred second language and distinguishes regular, CC/SDH, and forced tracks.
- Supports top or bottom placement for the second subtitle.
- Includes a matched-style mode that renders the selected main subtitle through the extension too.
- Provides local controls for size, outline, opacity, color, and vertical position.
- Keeps overlays inside the active fullscreen player.
- Publishes a local debug snapshot for subtitle timing investigations.

## Screenshots

The images below are neutral mock screenshots for the repository documentation. Chrome Web Store listings use real playback and extension UI captures.

![Dual subtitle overlay mock screenshot](docs/screenshots/dual-subtitles.svg)

![Toolbar popup settings mock screenshot](docs/screenshots/popup-settings.svg)

## How It Works

### HBO Max

HBO Max delivers playback through DASH manifests. The HBO extension watches for `.mpd` manifests, extracts segmented WebVTT tracks, and downloads only the selected track. HBO-specific presentation, media, and WebVTT timing data are normalized before rendering.

### Netflix

The Netflix extension runs a small page-world hook at `document_start`. It uses two compatible discovery paths:

1. It observes Netflix playback manifests when their text-track metadata is visible and caches them by `movieId`, so homepage preloading cannot replace the active title's tracks.
2. It reads the active Netflix player's official timed-text list and resolves the selected track from the current playback session when licensed manifest contents are not exposed.

Netflix IMSC/TTML and WebVTT text tracks are parsed locally. Signed subtitle delivery URLs stay in the active page and are never written to extension storage or the debug snapshot. Image-based subtitle tracks are currently omitted instead of being shown as unusable choices.

## Availability

MultiSub for HBO Max is available from the [Chrome Web Store](https://chromewebstore.google.com/detail/aibamjmjbaflpgokbdcindilmnngpbpg). The Netflix extension is currently available from this repository as the separate `dist/netflix` build. Both remain open source for review, testing, and contribution.

## Build

The recommended environment is WSL Ubuntu with the project-local Node 22 toolchain:

```bash
bash scripts/setup-node.sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm install
```

Run the full verification flow:

```bash
npm run typecheck
npm test
npm run build
```

Build either extension independently with `npm run build:hbo` or `npm run build:netflix`.

The unpacked extension directories are:

```text
dist/hbo/
dist/netflix/
```

`dist/` is generated and should not be committed. GitHub Actions packages the two directories as separate ZIP artifacts with each manifest at the archive root.

## Usage

### HBO Max

1. Load `dist/hbo` as an unpacked extension.
2. Open a supported HBO Max video and its audio/subtitles menu.
3. Choose the normal HBO subtitle as usual.
4. Choose a second track in the added `Secondary Subtitles` section.

### Netflix

1. Load `dist/netflix` as a separate unpacked extension.
2. Refresh Netflix so the page-world hook runs from `document_start`.
3. Open a video.
4. Select the second official track from the Netflix extension popup or its injected `Secondary Subtitles` section when the Netflix menu is available.

Both popups control only their own extension because Chrome gives the two packages separate storage areas. The Netflix popup queries and changes only the active playback tab; its saved language preference is reused when a future title opens.

## Debugging Subtitle Sync

With the relevant extension active on a playback page, inspect its JSON snapshot in DevTools:

```js
JSON.parse(document.querySelector('#hbo-dual-sub-debug').textContent)
JSON.parse(document.querySelector('#netflix-dual-sub-debug').textContent)
```

Snapshots include the current video time, native and extension-rendered subtitle text, selected tracks, cue counts, and active cues. The Netflix snapshot also reports whether the active video is muted, which is useful during test runs.

## Current Scope

- Targets: `https://play.hbomax.com/*` and `https://www.netflix.com/*`
- Platform: Chrome Manifest V3
- HBO formats: DASH/MPD with segmented WebVTT
- Netflix formats: official IMSC/TTML and WebVTT text tracks
- No AI translation, subtitle generation, external subtitle search, telemetry, or cross-region track loading

## References

Netflix compatibility references the actively maintained, MIT-licensed [gmertes/NflxMultiSubs](https://github.com/gmertes/NflxMultiSubs), particularly its early `document_start` hook, per-title manifest cache, and current/legacy Netflix field aliases. MultiSub keeps an independent MV3 package and uses its own page/content bridge, text-track parsers, renderer, settings, tests, and player-session fallback.

The HBO Max subtitle-discovery path retains the established DASH-manifest interception approach used by projects such as [asbplayer](https://github.com/killergerbah/asbplayer).

## Contributing

Issues and pull requests are welcome. Development and browser-test notes live in [AGENTS.md](AGENTS.md), and release history follows [Keep a Changelog](CHANGELOG.md).

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Netflix, Max, HBO, Warner Bros. Discovery, or their affiliates.

## License

MIT
