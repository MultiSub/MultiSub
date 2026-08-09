import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '../src/messages';
import { trackForNativeSubtitleLabel, tracksWithNativeLabels } from '../src/track-matching';

function track(id: string, label: string, language = 'en-US'): SubtitleTrack {
  return {
    id,
    label,
    language,
    segments: [{ url: `https://cdn.example/${id}.vtt` }],
  };
}

describe('subtitle track display and native matching', () => {
  it('matches an explicit CC track instead of a plain track in the same language', () => {
    const plain = track('plain', 'English');
    const closedCaptions = track('cc', 'en-US CC');

    expect(trackForNativeSubtitleLabel([plain, closedCaptions], 'English CC')?.id).toBe('cc');
    expect(trackForNativeSubtitleLabel([closedCaptions, plain], 'English')?.id).toBe('plain');
  });

  it('keeps HBO rendering when multiple same-kind tracks are ambiguous', () => {
    const firstClosedCaptions = track('cc-1', 'English CC');
    const secondClosedCaptions = track('cc-2', 'English SDH');

    expect(
      trackForNativeSubtitleLabel([firstClosedCaptions, secondClosedCaptions], 'English CC'),
    ).toBeUndefined();
  });

  it('does not expose or ambiguously select a UUID-named track', () => {
    const placeholder = track('placeholder', 'f31dc6e1-79a8-4caa-b11b-8d7ef5678251');
    const english = track('english', 'American English');
    const displayed = tracksWithNativeLabels([placeholder, english], ['English CC']);

    expect(displayed.map((item) => item.displayLabel)).toEqual(['English', 'English 2']);
    expect(trackForNativeSubtitleLabel([placeholder, english], 'English CC')).toBeUndefined();
  });

  it('uses the only same-language track when the manifest omits a CC marker', () => {
    const english = track('english', 'American English');

    expect(trackForNativeSubtitleLabel([english], 'English CC')?.id).toBe('english');
  });
});
