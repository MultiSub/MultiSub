import type { SubtitleTrack } from './messages';

export type DisplaySubtitleTrack = SubtitleTrack & {
  displayLabel: string;
  nativeOrder: number;
};

export function tracksWithNativeLabels(
  sourceTracks: SubtitleTrack[],
  nativeLabels: string[],
): DisplaySubtitleTrack[] {
  const nativeByLanguage = new Map<string, { label: string; order: number }>();

  nativeLabels.forEach((label, order) => {
    const key = labelLanguageKey(label);
    if (key !== undefined && !nativeByLanguage.has(key)) {
      nativeByLanguage.set(key, { label, order });
    }
  });

  const mappedTracks = sourceTracks
    .map((track, fallbackOrder) => {
      const native = nativeByLanguage.get(trackLanguageKey(track.language));
      const fallbackLabel = simplifiedTrackLabel(track);
      return {
        ...track,
        displayLabel:
          native !== undefined && shouldUseNativeDisplayLabel(track, native.label) ? native.label : fallbackLabel,
        nativeOrder: native?.order ?? nativeLabels.length + fallbackOrder,
      };
    })
    .sort((left, right) => left.nativeOrder - right.nativeOrder || left.displayLabel.localeCompare(right.displayLabel));

  return dedupeDisplayLabels(mappedTracks);
}

export function trackForNativeSubtitleLabel(
  sourceTracks: SubtitleTrack[],
  nativeLabel: string,
): SubtitleTrack | undefined {
  const languageKey = labelLanguageKey(nativeLabel);
  if (languageKey === undefined) {
    const exactMatches = sourceTracks.filter(
      (track) => track.label === nativeLabel || simplifiedTrackLabel(track) === nativeLabel,
    );
    return exactMatches.length === 1 ? exactMatches[0] : undefined;
  }

  const sameLanguageTracks = sourceTracks.filter((track) => trackLanguageKey(track.language) === languageKey);
  const nativeWantsClosedCaptions = isClosedCaptionLabel(nativeLabel);
  const matchingKind = sameLanguageTracks.filter(
    (track) => isClosedCaptionLabel(track.label) === nativeWantsClosedCaptions,
  );

  if (matchingKind.length === 1) {
    return matchingKind[0];
  }

  if (matchingKind.length > 1) {
    return undefined;
  }

  // A single language track is a safe fallback when HBO's manifest omits the
  // CC/SDH marker. Multiple ambiguous tracks must leave HBO's native caption
  // renderer active instead of hiding it for the wrong track.
  return sameLanguageTracks.length === 1 ? sameLanguageTracks[0] : undefined;
}

function shouldUseNativeDisplayLabel(track: SubtitleTrack, nativeLabel: string): boolean {
  const languageKey = trackLanguageKey(track.language);
  if (languageKey !== 'en') {
    return true;
  }

  const nativeIsClosedCaption = isClosedCaptionLabel(nativeLabel);
  if (!nativeIsClosedCaption) {
    return true;
  }

  return isClosedCaptionLabel(track.label);
}

function dedupeDisplayLabels<T extends DisplaySubtitleTrack>(tracksToDedupe: T[]): T[] {
  const labelCounts = new Map<string, number>();
  return tracksToDedupe.map((track) => {
    const count = labelCounts.get(track.displayLabel) ?? 0;
    labelCounts.set(track.displayLabel, count + 1);
    return count === 0 ? track : { ...track, displayLabel: `${track.displayLabel} ${count + 1}` };
  });
}

function simplifiedTrackLabel(track: SubtitleTrack): string {
  const key = trackLanguageKey(track.language);
  if (key === 'zh-Hans') {
    return 'Chinese (Simplified)';
  }
  if (key === 'zh-Hant') {
    return 'Chinese (Traditional)';
  }
  if (key === 'en') {
    return /^american english$/i.test(track.label) || isUuid(track.label) ? 'English' : track.label;
  }

  const label = isUuid(track.label) ? formatLanguage(track.language) : track.label;
  return label.replace(/\s+\((?:Malaysia|Singapore|Taiwan|United States)\)$/i, '');
}

function labelLanguageKey(label: string): string | undefined {
  if (/chinese.*simplified/i.test(label)) {
    return 'zh-Hans';
  }
  if (/chinese.*traditional/i.test(label)) {
    return 'zh-Hant';
  }
  if (/english/i.test(label)) {
    return 'en';
  }
  if (/indonesian/i.test(label)) {
    return 'id';
  }
  if (/malay/i.test(label)) {
    return 'ms';
  }
  if (/thai/i.test(label)) {
    return 'th';
  }

  return undefined;
}

function trackLanguageKey(language: string): string {
  const normalized = language.toLowerCase();
  if (normalized.startsWith('zh-hans') || normalized === 'zh-cn' || normalized === 'zh-sg') {
    return 'zh-Hans';
  }
  if (normalized.startsWith('zh-hant') || normalized === 'zh-tw' || normalized === 'zh-hk') {
    return 'zh-Hant';
  }
  return normalized.split('-')[0];
}

function isClosedCaptionLabel(label: string): boolean {
  return /\b(?:cc|sdh)\b/i.test(label);
}

function isUuid(value: string): boolean {
  return /^[{]?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[}]?$/i.test(value.trim());
}

function formatLanguage(language: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}
