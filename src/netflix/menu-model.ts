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

export interface NetflixMenuTypographySample {
  fontSize: number;
  depth: number;
}

export function selectNetflixMenuTypographySample<T extends NetflixMenuTypographySample>(
  samples: readonly T[],
): T | undefined {
  let selected: T | undefined;
  for (const sample of samples) {
    if (!Number.isFinite(sample.fontSize) || sample.fontSize <= 0) {
      continue;
    }
    if (
      selected === undefined ||
      sample.fontSize > selected.fontSize ||
      (sample.fontSize === selected.fontSize && sample.depth > selected.depth)
    ) {
      selected = sample;
    }
  }
  return selected;
}
