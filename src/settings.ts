export const SETTINGS_STORAGE_KEY = 'hboDualSubSettings';

export type PrimarySubtitleMode = 'native' | 'plugin';
export type SecondarySubtitlePlacement = 'top' | 'bottom';

export interface SubtitleSettings {
  primarySubtitleMode: PrimarySubtitleMode;
  secondarySubtitlePlacement: SecondarySubtitlePlacement;
  secondaryTextScale: number;
  secondaryTextStroke: number;
  secondaryTextOpacity: number;
  secondaryTextColor: string;
  secondaryBottomVh: number;
}

export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  primarySubtitleMode: 'native',
  secondarySubtitlePlacement: 'bottom',
  secondaryTextScale: 1,
  secondaryTextStroke: 2,
  secondaryTextOpacity: 1,
  secondaryTextColor: '#ffffff',
  secondaryBottomVh: 13,
};

export function sanitizeSubtitleSettings(value: unknown): SubtitleSettings {
  const input = isRecord(value) ? value : {};
  return {
    primarySubtitleMode:
      input.primarySubtitleMode === 'plugin' || input.primarySubtitleMode === 'native'
        ? input.primarySubtitleMode
        : DEFAULT_SUBTITLE_SETTINGS.primarySubtitleMode,
    secondarySubtitlePlacement:
      input.secondarySubtitlePlacement === 'top' || input.secondarySubtitlePlacement === 'bottom'
        ? input.secondarySubtitlePlacement
        : DEFAULT_SUBTITLE_SETTINGS.secondarySubtitlePlacement,
    secondaryTextScale: clampNumber(input.secondaryTextScale, 0.7, 1.6, DEFAULT_SUBTITLE_SETTINGS.secondaryTextScale),
    secondaryTextStroke: clampNumber(input.secondaryTextStroke, 0, 4, DEFAULT_SUBTITLE_SETTINGS.secondaryTextStroke),
    secondaryTextOpacity: clampNumber(input.secondaryTextOpacity, 0.35, 1, DEFAULT_SUBTITLE_SETTINGS.secondaryTextOpacity),
    secondaryTextColor: sanitizeColor(input.secondaryTextColor, DEFAULT_SUBTITLE_SETTINGS.secondaryTextColor),
    secondaryBottomVh: clampNumber(input.secondaryBottomVh, 7, 24, DEFAULT_SUBTITLE_SETTINGS.secondaryBottomVh),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, numberValue));
}

function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}
