import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '../src/messages';
import { didSubtitleTrackChange, hasUsableSubtitleCues, shouldUsePluginPrimary } from '../src/subtitle-state';

describe('primary subtitle render state', () => {
  it('keeps HBO captions visible until usable primary cues are loaded', () => {
    expect(shouldUsePluginPrimary('plugin', 'english', [])).toBe(false);
    expect(shouldUsePluginPrimary('plugin', 'english', [{ start: 0, end: 10, text: ' \u00a0 ' }])).toBe(false);
    expect(shouldUsePluginPrimary('plugin', 'english', [{ start: 0, end: 10, text: 'Hello' }])).toBe(true);
  });

  it('never replaces HBO captions outside Matched style or without a selected track', () => {
    const cues = [{ start: 0, end: 10, text: 'Hello' }];
    expect(shouldUsePluginPrimary('native', 'english', cues)).toBe(false);
    expect(shouldUsePluginPrimary('plugin', null, cues)).toBe(false);
    expect(hasUsableSubtitleCues(cues)).toBe(true);
  });

  it('invalidates readiness when a stable track id points at new segments', () => {
    const previousTrack: SubtitleTrack = {
      id: 'english',
      label: 'English CC',
      language: 'en-US',
      segments: [{ url: 'https://cdn.example/episode-1.vtt', presentationTime: 0 }],
    };
    const unchangedTrack: SubtitleTrack = {
      ...previousTrack,
      segments: [...previousTrack.segments],
    };
    const nextTrack: SubtitleTrack = {
      ...previousTrack,
      segments: [{ url: 'https://cdn.example/episode-2.vtt', presentationTime: 0 }],
    };

    expect(didSubtitleTrackChange(previousTrack, unchangedTrack)).toBe(false);
    expect(didSubtitleTrackChange(previousTrack, nextTrack)).toBe(true);
    expect(didSubtitleTrackChange(previousTrack, undefined)).toBe(true);
  });
});
