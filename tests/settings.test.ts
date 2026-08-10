import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SUBTITLE_SETTINGS,
  isSubtitleFontFamily,
  sanitizeSubtitleSettings,
  subtitleFontFamilyCss,
} from '../src/settings';

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
      subtitleFontFamily: 'sans-serif',
    });
    expect(settings).not.toHaveProperty('secondaryLanguageMode');
  });

  it('accepts supported display modes', () => {
    expect(
      sanitizeSubtitleSettings({
        primarySubtitleMode: 'plugin',
        secondarySubtitlePlacement: 'top',
        subtitleFontFamily: 'serif',
      }),
    ).toMatchObject({
      primarySubtitleMode: 'plugin',
      secondarySubtitlePlacement: 'top',
      subtitleFontFamily: 'serif',
    });
  });

  it('falls back to sans-serif for an unsupported font family', () => {
    expect(sanitizeSubtitleSettings({ subtitleFontFamily: 'fantasy' }).subtitleFontFamily).toBe('sans-serif');
    expect(sanitizeSubtitleSettings({ subtitleFontFamily: 'serif; color: red' }).subtitleFontFamily).toBe('sans-serif');
    expect(isSubtitleFontFamily('sans-serif')).toBe(true);
    expect(isSubtitleFontFamily('serif')).toBe(true);
    expect(isSubtitleFontFamily('fantasy')).toBe(false);
  });

  it('maps font choices to local fallback stacks', () => {
    expect(subtitleFontFamilyCss('sans-serif')).toBe('Arial, Helvetica, sans-serif');
    expect(subtitleFontFamilyCss('serif')).toBe('Georgia, "Times New Roman", serif');
  });

  it('sanitizes text color', () => {
    expect(sanitizeSubtitleSettings({ secondaryTextColor: '#FFE66D' }).secondaryTextColor).toBe('#ffe66d');
    expect(sanitizeSubtitleSettings({ secondaryTextColor: 'red' }).secondaryTextColor).toBe('#ffffff');
  });
});
