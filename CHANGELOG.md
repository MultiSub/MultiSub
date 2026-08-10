# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a second, independently packaged Manifest V3 extension for Netflix.
- Added current-player timed-text discovery with a per-title manifest cache and a Netflix player-session fallback.
- Added IMSC/TTML parsing for tick, clock, frame, and offset times, including line breaks and ruby handling.
- Added Netflix popup and native-menu second-track selection, matched-style rendering, fullscreen overlays, and local debug snapshots.
- Added separate `dist/hbo` and `dist/netflix` build artifacts and CI packages.
- Added a sans-serif or serif font choice for extension-rendered subtitles in both popups.

### Changed

- Unified HBO Max and Netflix subtitle selection around a three-column audio, primary subtitle, and secondary subtitle layout.
- Scoped Netflix popup track changes to the active tab while keeping only the language preference for future playback restoration.

## [0.1.1] - 2026-08-10

### Changed

- Combined the primary and secondary subtitle selectors into one scrollable column so the primary language list no longer collapses to only a few visible rows.
- Matched the secondary subtitle selector's type size, spacing, and selection mark to HBO Max's native subtitle controls.

### Fixed

- Prevented extension-owned menu updates from repeatedly rebuilding unchanged selector content, keeping the shared scroll position and focused option stable.

## [0.1.0] - 2026-08-10

### Added

- Added a user-selectable second official subtitle track for HBO Max playback.
- Added top and bottom placement, matched primary-subtitle rendering, and local appearance controls.
- Added support for normal and fullscreen playback using only subtitle tracks supplied by HBO Max.

[Unreleased]: https://github.com/MultiSub/MultiSub/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/MultiSub/MultiSub/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/MultiSub/MultiSub/tree/v0.1.0
