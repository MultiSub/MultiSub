import type { SubtitleCue, SubtitleSegment, SubtitleTrack } from './messages';
import type { PrimarySubtitleMode } from './settings';

export const LOWER_SUBTITLE_SLOT_HOLD_SECONDS = 0.5;

interface LowerSubtitleSlotState {
  activeUpperCues: SubtitleCue[];
  currentTime: number;
  heldForUpperText: string | null;
  lowerSlotOccupied: boolean;
  lowerText: string;
  previousUpperText: string;
  reset: boolean;
  stacked: boolean;
  upperText: string;
}

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

export function shouldPreserveLowerSubtitleSlot({
  activeUpperCues,
  currentTime,
  heldForUpperText,
  lowerSlotOccupied,
  lowerText,
  previousUpperText,
  reset,
  stacked,
  upperText,
}: LowerSubtitleSlotState): boolean {
  if (
    reset ||
    !stacked ||
    !lowerSlotOccupied ||
    lowerText.trim() !== '' ||
    upperText.trim() === '' ||
    (heldForUpperText === null && previousUpperText !== upperText) ||
    (heldForUpperText !== null && heldForUpperText !== upperText)
  ) {
    return false;
  }

  const latestUpperCueEnd = activeUpperCues.reduce(
    (latestEnd, cue) => cue.text.trim() === '' ? latestEnd : Math.max(latestEnd, cue.end),
    Number.NEGATIVE_INFINITY,
  );
  const remaining = latestUpperCueEnd - currentTime;
  return remaining >= 0 && remaining <= LOWER_SUBTITLE_SLOT_HOLD_SECONDS;
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
