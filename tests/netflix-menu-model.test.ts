import { describe, expect, it } from 'vitest';
import {
  isNetflixAudioSubtitlePanelCandidate,
  isNetflixMenuPopoverAnchorCandidate,
} from '../src/netflix/menu-model';

describe('isNetflixAudioSubtitlePanelCandidate', () => {
  it('accepts only the exact Netflix audio/subtitle panel root', () => {
    expect(isNetflixAudioSubtitlePanelCandidate('DIV', 'selector-audio-subtitle', 2)).toBe(true);
  });

  it('rejects controls, alternate tags, prefixes, and empty containers', () => {
    expect(isNetflixAudioSubtitlePanelCandidate('BUTTON', 'selector-audio-subtitle', 2)).toBe(false);
    expect(isNetflixAudioSubtitlePanelCandidate('SECTION', 'selector-audio-subtitle', 2)).toBe(false);
    expect(isNetflixAudioSubtitlePanelCandidate('DIV', 'selector-audio-subtitle-list', 2)).toBe(false);
    expect(isNetflixAudioSubtitlePanelCandidate('DIV', 'selector-audio-subtitle', 0)).toBe(false);
  });
});

describe('isNetflixMenuPopoverAnchorCandidate', () => {
  it('accepts a positioned menu-only popover', () => {
    expect(isNetflixMenuPopoverAnchorCandidate('absolute', false)).toBe(true);
    expect(isNetflixMenuPopoverAnchorCandidate('fixed', false)).toBe(true);
  });

  it('never reanchors ordinary layout or the watch-video ancestor', () => {
    expect(isNetflixMenuPopoverAnchorCandidate('relative', false)).toBe(false);
    expect(isNetflixMenuPopoverAnchorCandidate('static', false)).toBe(false);
    expect(isNetflixMenuPopoverAnchorCandidate('absolute', true)).toBe(false);
    expect(isNetflixMenuPopoverAnchorCandidate('fixed', true)).toBe(false);
  });
});
