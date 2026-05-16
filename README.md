# MultiSubs for HBO Max

Free and open-source Chrome MV3 extension for showing two official subtitle tracks on HBO Max.

It uses subtitle tracks already present in the HBO Max DASH/MPD manifest for the current title.

## Features

- Adds a `Secondary Subtitles` section to HBO Max's native audio/subtitle menu.
- Loads only the selected secondary subtitle track.
- Renders the second subtitle as a transparent text overlay, without a blocking black background.
- Optional `Matched style` mode lets the extension render the main subtitle too, hiding HBO's native caption DOM once the matching official track is loaded.
- Lets the second subtitle sit either near the top of the video or in the lower subtitle area; plugin-rendered main subtitles always stay at the bottom.
- Remembers the last selected secondary subtitle when a video opens.
- Adds a toolbar popup for display and appearance settings: main subtitle mode, second subtitle position, size, outline thickness, opacity, vertical position, and color.

## Inspiration

The interaction model is inspired by [SeeingDouble](https://github.com/jennimao/seeingdouble), especially its approach of integrating the second subtitle choice into the native player menu and exposing a toolbar settings panel. SeeingDouble is itself a fork of [gmertes/NflxMultiSubs](https://github.com/gmertes/NflxMultiSubs), which is a maintained fork of the original [dannvix/NflxMultiSubs](https://github.com/dannvix/NflxMultiSubs).

HBO Max subtitle discovery follows the same broad idea used by asbplayer for HBO Max: intercept the DASH `.mpd` manifest and extract the available subtitle playlists.

## Install

Build the extension, then load the generated `dist` directory from `chrome://extensions` with developer mode enabled.

After clicking Reload in `chrome://extensions`, refresh the HBO Max playback tab so the new content script and page hook are installed from `document_start`.

## Development

Use the project-local Node toolchain in `.tools/node` after it is installed:

```bash
bash scripts/setup-node.sh
export PATH="$PWD/.tools/node/bin:$PATH"
npm install
npm run build
npm test
```

## Verification Checklist

- HBO's original subtitle menu still works.
- `Secondary Subtitles` appears in the native audio/subtitle menu.
- Selecting `Off` clears the secondary overlay immediately.
- Selecting a second language loads only that track and keeps it synced to `video.currentTime`.
- In `Matched style` mode, the HBO subtitle choice becomes the main subtitle choice, HBO's native caption styling is hidden, and the extension renders both subtitle lines consistently.
- The popup's second subtitle position setting can move only the second subtitle; the main subtitle remains at the bottom.
- Seeking with the progress bar updates the secondary overlay to the new playback time.
- Reloading the page restores the last secondary subtitle.
- The toolbar popup updates subtitle appearance live on the playback page.

## Debugging Subtitle Sync

The extension writes a live JSON snapshot into the HBO page at `#hbo-dual-sub-debug`. After reloading the unpacked extension and refreshing the playback page, run this in DevTools Console:

```js
JSON.parse(document.querySelector('#hbo-dual-sub-debug').textContent)
```

The snapshot includes the current `video.currentTime`, HBO's native subtitle DOM text, the secondary overlay text, selected secondary track, active secondary cues, nearby cues, available tracks, and manifest/video timeline metadata. When two subtitles do not match, capture this snapshot at the bad frame; it usually tells us whether the issue is a wrong track, wrong cue time, stale cues after seeking, or a difference between HBO's CC and non-CC subtitle tracks.

## Scope

- Current target: `https://play.hbomax.com/*`.
- Current subtitle format: DASH/MPD playlists with WebVTT subtitle segments.
- No AI translation, subtitle generation, external subtitle search, or cross-region subtitle loading.

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Max, HBO, or Warner Bros. Discovery.

## License

MIT
