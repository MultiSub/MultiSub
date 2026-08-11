import { describe, expect, it } from 'vitest';
import type { SubtitleTrack } from '../src/messages';
import {
  didSubtitleTrackChange,
  hasUsableSubtitleCues,
  shouldPreserveLowerSubtitleSlot,
  shouldUsePluginPrimary,
} from '../src/subtitle-state';

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

  it('preserves a disappearing lower subtitle only while the current upper subtitle is about to end', () => {
    const base = {
      activeUpperCues: [{ start: 8, end: 10.4, text: 'Upper' }],
      currentTime: 10,
      heldForUpperText: null,
      lowerSlotOccupied: true,
      lowerText: '',
      previousUpperText: 'Upper',
      reset: false,
      stacked: true,
      upperText: 'Upper',
    };

    expect(shouldPreserveLowerSubtitleSlot(base)).toBe(true);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, heldForUpperText: 'Upper', currentTime: 10.2 })).toBe(true);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, upperText: '', activeUpperCues: [] })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, activeUpperCues: [{ start: 8, end: 12, text: 'Upper' }] })).toBe(false);
  });

  it('does not create or carry a lower layout slot across unrelated subtitle states', () => {
    const base = {
      activeUpperCues: [{ start: 8, end: 10.4, text: 'Upper' }],
      currentTime: 10,
      heldForUpperText: null,
      lowerSlotOccupied: true,
      lowerText: '',
      previousUpperText: 'Upper',
      reset: false,
      stacked: true,
      upperText: 'Upper',
    };

    expect(shouldPreserveLowerSubtitleSlot({ ...base, stacked: false })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, reset: true })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, lowerSlotOccupied: false })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, lowerText: 'New lower cue' })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, previousUpperText: 'Previous upper cue' })).toBe(false);
    expect(shouldPreserveLowerSubtitleSlot({ ...base, heldForUpperText: 'Previous upper cue' })).toBe(false);
  });

  it('uses the latest end when several upper cues overlap', () => {
    expect(shouldPreserveLowerSubtitleSlot({
      activeUpperCues: [
        { start: 8, end: 10.2, text: 'First line' },
        { start: 8.5, end: 11.5, text: 'Second line' },
      ],
      currentTime: 10,
      heldForUpperText: null,
      lowerSlotOccupied: true,
      lowerText: '',
      previousUpperText: 'First line\nSecond line',
      reset: false,
      stacked: true,
      upperText: 'First line\nSecond line',
    })).toBe(false);
  });
});
