import { describe, expect, it } from 'vitest';
import {
  extractMpdMediaPresentationDuration,
  parseIso8601DurationSeconds,
  subtitleTimelineOffset,
} from '../src/timeline';

describe('parseIso8601DurationSeconds', () => {
  it('parses DASH duration strings', () => {
    expect(parseIso8601DurationSeconds('PT58M12.108S')).toBeCloseTo(3492.108);
    expect(parseIso8601DurationSeconds('P1DT2H3M4.5S')).toBeCloseTo(93784.5);
  });

  it('rejects unsupported duration strings', () => {
    expect(parseIso8601DurationSeconds('PT')).toBeUndefined();
    expect(parseIso8601DurationSeconds('P1M')).toBeUndefined();
  });
});

describe('extractMpdMediaPresentationDuration', () => {
  it('extracts mediaPresentationDuration from the MPD tag', () => {
    expect(
      extractMpdMediaPresentationDuration(
        `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" mediaPresentationDuration="PT57M57.108S"><Period /></MPD>`,
      ),
    ).toBeCloseTo(3477.108);
  });
});

describe('subtitleTimelineOffset', () => {
  it('uses the player duration delta as the cue offset for small HBO timeline shifts', () => {
    expect(subtitleTimelineOffset(3492.108, 3477.108)).toBe(15);
  });

  it('ignores tiny rounding differences and implausibly large differences', () => {
    expect(subtitleTimelineOffset(3492.2, 3492.108)).toBe(0);
    expect(subtitleTimelineOffset(3600, 3000)).toBe(0);
  });
});
