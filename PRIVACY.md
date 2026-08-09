# Privacy Policy for MultiSub for HBO Max

Last updated: August 9, 2026

MultiSub for HBO Max is an independent browser extension that displays a second official subtitle track during HBO Max playback. It is not affiliated with, endorsed by, or sponsored by Max, HBO, or Warner Bros. Discovery.

## Data processed by the extension

To provide dual subtitles, the extension runs only on `https://play.hbomax.com/` and locally processes:

- HBO Max video manifest requests and the official subtitle-track metadata they contain;
- subtitle text and timing data for the subtitle tracks selected by the user;
- the current HBO Max playback page URL and player timing/state; and
- the user's subtitle choices and display preferences.

This processing happens locally in the browser. The developer does not receive, collect, sell, analyze, or use this data for advertising.

## Data stored locally

The extension uses `chrome.storage.local` to remember the selected secondary subtitle language or track and display preferences such as rendering mode, placement, size, outline, opacity, color, and vertical position. These settings remain on the user's device until the user clears extension data or uninstalls the extension.

Playback manifests, subtitle cues, player state, and diagnostic data are kept only in the active HBO Max page session and are discarded when the page is refreshed or closed. A local diagnostic snapshot may be exposed in the HBO Max page at `#hbo-dual-sub-debug` to help the user troubleshoot subtitle synchronization. It can contain current subtitle text, timing, track metadata, and HBO Max playback or subtitle-resource URLs. This snapshot is not transmitted to the developer.

## Network requests and sharing

The extension requests subtitle data only from delivery URLs supplied by the active HBO Max manifest. Those requests are part of the user's current HBO Max playback session and may be served by HBO Max or its content-delivery providers.

The extension does not send data to the developer or to analytics, advertising, or external subtitle services. It does not sell data or share data for purposes unrelated to its single purpose.

## Remote code

The extension does not execute remotely hosted code. All executable JavaScript is included in the extension package. HBO Max manifests and WebVTT subtitle files are processed only as data and are never evaluated as code.

## Limited use

Any use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide and improve the extension's user-facing dual-subtitle functionality.

## Contact

Questions about this policy can be sent to `andreychen9@gmail.com`.
