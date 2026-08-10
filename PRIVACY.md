# Privacy Policy for MultiSub

Last updated: August 10, 2026

MultiSub provides two independently packaged browser extensions that display a second official subtitle track during HBO Max or Netflix playback. It is not affiliated with, endorsed by, or sponsored by Netflix, Max, HBO, Warner Bros. Discovery, or their affiliates.

## Data processed by the extension

To provide dual subtitles, the relevant extension runs only on `https://play.hbomax.com/` or `https://www.netflix.com/` and locally processes:

- playback manifests, official subtitle-track metadata, and active player-session track metadata;
- subtitle text and timing data for the subtitle tracks selected by the user;
- the current playback page URL and player timing/state; and
- the user's subtitle choices and display preferences.

This processing happens locally in the browser. The developer does not receive, collect, sell, analyze, or use this data for advertising.

## Data stored locally

Each extension uses its own `chrome.storage.local` area to remember the selected secondary subtitle language or track and display preferences such as rendering mode, placement, font family, size, outline, opacity, color, and vertical position. These settings remain on the user's device until the user clears extension data or uninstalls that extension.

Playback manifests, subtitle cues, player state, and diagnostic data are kept only in the active page session and are discarded when the page is refreshed or closed. Local diagnostic snapshots may be exposed at `#hbo-dual-sub-debug` or `#netflix-dual-sub-debug` to help troubleshoot synchronization. They can contain current subtitle text, timing, and track metadata. The HBO snapshot may also contain playback or subtitle-resource URLs. Signed Netflix subtitle URLs are not written to storage or the Netflix snapshot. Neither snapshot is transmitted to the developer.

## Network requests and sharing

Each extension requests subtitle data only from delivery URLs supplied by the active HBO Max or Netflix playback session. Those requests may be served by the streaming service or its content-delivery providers.

The extension does not send data to the developer or to analytics, advertising, or external subtitle services. It does not sell data or share data for purposes unrelated to its single purpose.

## Remote code

The extensions do not execute remotely hosted code. All executable JavaScript is included in each extension package. Playback manifests, WebVTT, and IMSC/TTML subtitle files are processed only as data and are never evaluated as code.

## Limited use

Any use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide and improve the extension's user-facing dual-subtitle functionality.

## Contact

Questions about this policy can be sent to `andreychen9@gmail.com`.
