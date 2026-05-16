import { describe, expect, it } from 'vitest';
import { DEFAULT_SUBTITLE_SETTINGS, sanitizeSubtitleSettings } from '../src/settings';

describe('sanitizeSubtitleSettings', () => {
  it('fills missing values with defaults', () => {
    expect(sanitizeSubtitleSettings(undefined)).toEqual(DEFAULT_SUBTITLE_SETTINGS);
  });

  it('clamps numeric values and ignores the removed startup mode', () => {
    const settings = sanitizeSubtitleSettings({
      secondaryTextScale: 99,
      secondaryTextStroke: -2,
      secondaryTextOpacity: 0.1,
      secondaryBottomVh: 30,
      secondaryLanguageMode: 'off',
    });

    expect(settings).toMatchObject({
      secondaryTextScale: 1.6,
      secondaryTextStroke: 0,
      secondaryTextOpacity: 0.35,
      secondaryBottomVh: 24,
    });
    expect(settings).not.toHaveProperty('secondaryLanguageMode');
  });

  it('accepts supported display modes', () => {
    expect(
      sanitizeSubtitleSettings({
        primarySubtitleMode: 'plugin',
        secondarySubtitlePlacement: 'top',
      }),
    ).toMatchObject({
      primarySubtitleMode: 'plugin',
      secondarySubtitlePlacement: 'top',
    });
  });

  it('sanitizes text color', () => {
    expect(sanitizeSubtitleSettings({ secondaryTextColor: '#FFE66D' }).secondaryTextColor).toBe('#ffe66d');
    expect(sanitizeSubtitleSettings({ secondaryTextColor: 'red' }).secondaryTextColor).toBe('#ffffff');
  });
});
