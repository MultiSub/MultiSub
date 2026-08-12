import { describe, expect, it } from 'vitest';
import {
  isNetflixAudioSubtitlePanelCandidate,
  isNetflixMenuPopoverAnchorCandidate,
  selectNetflixMenuTypographySample,
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

describe('selectNetflixMenuTypographySample', () => {
  it('prefers the rendered descendant text size over a small layout container', () => {
    const container = { name: 'option container', fontSize: 8, depth: 0 };
    const label = { name: 'visible label', fontSize: 18, depth: 2 };

    expect(selectNetflixMenuTypographySample([container, label])).toBe(label);
  });

  it('prefers the deepest text node when inherited sizes are equal', () => {
    const wrapper = { name: 'wrapper', fontSize: 16, depth: 1 };
    const label = { name: 'label', fontSize: 16, depth: 3 };

    expect(selectNetflixMenuTypographySample([wrapper, label])).toBe(label);
  });

  it('ignores invalid measurements', () => {
    expect(selectNetflixMenuTypographySample([
      { fontSize: Number.NaN, depth: 2 },
      { fontSize: 0, depth: 3 },
    ])).toBeUndefined();
  });
});
