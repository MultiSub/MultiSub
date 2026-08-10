export function isNetflixAudioSubtitlePanelCandidate(
  tagName: string,
  dataUia: string | null,
  nativeOptionCount: number,
): boolean {
  return tagName.toUpperCase() === 'DIV' &&
    dataUia === 'selector-audio-subtitle' &&
    nativeOptionCount > 0;
}

export function isNetflixMenuPopoverAnchorCandidate(
  position: string,
  containsVideo: boolean,
): boolean {
  return (position === 'absolute' || position === 'fixed') && !containsVideo;
}
