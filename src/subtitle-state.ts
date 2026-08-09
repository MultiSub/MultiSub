import type { SubtitleCue, SubtitleSegment, SubtitleTrack } from './messages';
import type { PrimarySubtitleMode } from './settings';

export function hasUsableSubtitleCues(cues: SubtitleCue[]): boolean {
  return cues.some((cue) => cue.text.trim() !== '');
}

export function shouldUsePluginPrimary(
  primarySubtitleMode: PrimarySubtitleMode,
  primaryTrackId: string | null,
  primaryCues: SubtitleCue[],
): boolean {
  return primarySubtitleMode === 'plugin' && primaryTrackId !== null && hasUsableSubtitleCues(primaryCues);
}

export function didSubtitleTrackChange(
  previousTrack: SubtitleTrack | undefined,
  nextTrack: SubtitleTrack | undefined,
): boolean {
  return subtitleTrackSignature(previousTrack) !== subtitleTrackSignature(nextTrack);
}

function subtitleTrackSignature(track: SubtitleTrack | undefined): string | undefined {
  if (track === undefined) {
    return undefined;
  }

  const variants = track.variants ?? [{ segments: track.segments }];
  return variants
    .flatMap((variant) => variant.segments)
    .map(segmentSignature)
    .join('\n');
}

function segmentSignature(segment: SubtitleSegment): string {
  return [segment.url, segment.duration, segment.presentationTime, segment.mediaTime].join('|');
}
