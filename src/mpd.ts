import { parse as parseMpd } from 'mpd-parser';
import type { SubtitleSegment, SubtitleTrack, SubtitleTrackVariant } from './messages';

interface ParsedPlaylist {
  attributes?: Record<string, unknown>;
  resolvedUri?: unknown;
  segments?: unknown;
}

interface ParsedSegment {
  resolvedUri?: unknown;
  duration?: unknown;
  presentationTime?: unknown;
}

interface SubtitleGroupInfo {
  playlists?: ParsedPlaylist[];
  language?: unknown;
  lang?: unknown;
}

interface SubtitleTrackCandidate extends SubtitleTrack {
  genericKey?: string;
}

interface TimelineRange {
  start: number;
  end: number;
}

export function extractSubtitleTracksFromMpd(manifestText: string, manifestUrl: string): SubtitleTrack[] {
  const tracks = extractSubtitleTracksFromParsedManifest(parseMpd(manifestText, { manifestUri: manifestUrl }));
  return withMpdMediaTimes(tracks, extractSegmentMediaTimesFromMpd(manifestText, manifestUrl));
}

export function extractSubtitleTracksFromParsedManifest(parsedManifest: unknown): SubtitleTrack[] {
  const subGroups = getSubtitleGroups(parsedManifest);
  const candidates: SubtitleTrackCandidate[] = [];

  for (const [groupLabel, info] of Object.entries(subGroups)) {
    const playlists = Array.isArray(info?.playlists) ? info.playlists : [];

    for (const playlist of playlists as ParsedPlaylist[]) {
      const segments = extractSegments(playlist).filter((segment) => !isEmptySubtitlePlaceholderUrl(segment.url));
      if (segments.length === 0) {
        continue;
      }

      const trackLanguage = extractLanguage(groupLabel, playlist, info);
      const labelInfo = trackLabel(groupLabel, trackLanguage);
      candidates.push({
        id: createTrackId(trackLanguage, labelInfo.label),
        label: labelInfo.label,
        language: trackLanguage,
        segments,
        genericKey: labelInfo.genericLanguageLabel ? `${trackLanguage}:${labelInfo.label}` : undefined,
      });
    }
  }

  return dedupeFinalLabels(groupEquivalentTracks(candidates));
}

function getSubtitleGroups(parsedManifest: unknown): Record<string, SubtitleGroupInfo> {
  if (typeof parsedManifest !== 'object' || parsedManifest === null) {
    return {};
  }

  const mediaGroups = (parsedManifest as { mediaGroups?: unknown }).mediaGroups;
  if (typeof mediaGroups !== 'object' || mediaGroups === null) {
    return {};
  }

  const subtitles = (mediaGroups as { SUBTITLES?: unknown }).SUBTITLES;
  if (typeof subtitles !== 'object' || subtitles === null) {
    return {};
  }

  const subs = (subtitles as { subs?: unknown }).subs;
  return typeof subs === 'object' && subs !== null
    ? (subs as Record<string, SubtitleGroupInfo>)
    : {};
}

function extractSegments(playlist: ParsedPlaylist): SubtitleSegment[] {
  const rawSegments = Array.isArray(playlist.segments) ? (playlist.segments as ParsedSegment[]) : [];
  const segments: SubtitleSegment[] = rawSegments.flatMap((segment) => {
    if (typeof segment.resolvedUri !== 'string' || segment.resolvedUri.trim() === '') {
      return [];
    }

    return [
      {
        url: segment.resolvedUri.trim(),
        duration: typeof segment.duration === 'number' ? segment.duration : undefined,
        presentationTime: typeof segment.presentationTime === 'number' ? segment.presentationTime : undefined,
      },
    ];
  });

  if (segments.length === 0 && typeof playlist.resolvedUri === 'string' && playlist.resolvedUri.trim() !== '') {
    segments.push({ url: playlist.resolvedUri.trim() });
  }

  return segments;
}

function withMpdMediaTimes(tracks: SubtitleTrack[], mediaTimesByUrl: Map<string, number>): SubtitleTrack[] {
  if (mediaTimesByUrl.size === 0) {
    return tracks;
  }

  return tracks.map((track) => ({
    ...track,
    segments: track.segments.map((segment) => withMpdMediaTime(segment, mediaTimesByUrl)),
    variants: track.variants?.map((variant) => ({
      segments: variant.segments.map((segment) => withMpdMediaTime(segment, mediaTimesByUrl)),
    })),
  }));
}

function withMpdMediaTime(segment: SubtitleSegment, mediaTimesByUrl: Map<string, number>): SubtitleSegment {
  const mediaTime = mediaTimesByUrl.get(segment.url) ?? mediaTimesByUrl.get(segmentUrlTail(segment.url));
  return mediaTime === undefined ? segment : { ...segment, mediaTime };
}

function extractSegmentMediaTimesFromMpd(manifestText: string, manifestUrl: string): Map<string, number> {
  if (typeof DOMParser === 'undefined') {
    return new Map();
  }

  try {
    const document = new DOMParser().parseFromString(manifestText, 'application/xml');
    const mediaTimesByUrl = new Map<string, number>();

    for (const period of directChildrenByLocalName(document.documentElement, 'Period')) {
      const periodBaseUrls = resolveBaseUrls([manifestUrl], period);

      for (const adaptationSet of directChildrenByLocalName(period, 'AdaptationSet')) {
        if (!isTextAdaptationSet(adaptationSet)) {
          continue;
        }

        const adaptationBaseUrls = resolveBaseUrls(periodBaseUrls, adaptationSet);
        const adaptationTemplate = directChildrenByLocalName(adaptationSet, 'SegmentTemplate')[0];

        for (const representation of directChildrenByLocalName(adaptationSet, 'Representation')) {
          const template = directChildrenByLocalName(representation, 'SegmentTemplate')[0] ?? adaptationTemplate;
          const media = template?.getAttribute('media');
          if (template === undefined || media === null || media.trim() === '') {
            continue;
          }

          const representationBaseUrls = resolveBaseUrls(adaptationBaseUrls, representation);
          const timescale = positiveNumber(template.getAttribute('timescale')) ?? 1;
          const startNumber = positiveNumber(template.getAttribute('startNumber')) ?? 1;
          const entries = segmentTimelineEntries(template, timescale);

          entries.forEach((entry, index) => {
            const number = startNumber + index;
            const url = templateUrl(media, representation, number, entry.rawTime);
            for (const baseUrl of representationBaseUrls) {
              const resolvedUrl = absoluteManifestUrl(baseUrl, url);
              mediaTimesByUrl.set(resolvedUrl, entry.mediaTime);
              mediaTimesByUrl.set(segmentUrlTail(resolvedUrl), entry.mediaTime);
            }
          });
        }
      }
    }

    return mediaTimesByUrl;
  } catch {
    return new Map();
  }
}

function isTextAdaptationSet(adaptationSet: Element): boolean {
  const searchable = [
    adaptationSet.getAttribute('contentType'),
    adaptationSet.getAttribute('mimeType'),
    ...directChildrenByLocalName(adaptationSet, 'Representation').flatMap((representation) => [
      representation.getAttribute('mimeType'),
      representation.getAttribute('codecs'),
    ]),
    ...directChildrenByLocalName(adaptationSet, 'Role').map((role) => role.getAttribute('value')),
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  return /\btext\b|text\/vtt|wvtt|vtt|subtitle|caption/.test(searchable);
}

function segmentTimelineEntries(template: Element, timescale: number): Array<{ rawTime: number; mediaTime: number }> {
  const timeline = directChildrenByLocalName(template, 'SegmentTimeline')[0];
  const entries = timeline === undefined ? [] : directChildrenByLocalName(timeline, 'S');
  const result: Array<{ rawTime: number; mediaTime: number }> = [];
  let currentRawTime = 0;

  for (const entry of entries) {
    const explicitTime = numberAttribute(entry, 't');
    const duration = numberAttribute(entry, 'd');
    const repeat = numberAttribute(entry, 'r') ?? 0;

    if (explicitTime !== undefined) {
      currentRawTime = explicitTime;
    }

    if (duration === undefined || repeat < 0) {
      continue;
    }

    for (let index = 0; index <= repeat; index += 1) {
      result.push({ rawTime: currentRawTime, mediaTime: currentRawTime / timescale });
      currentRawTime += duration;
    }
  }

  if (result.length === 0) {
    const duration = numberAttribute(template, 'duration');
    if (duration !== undefined) {
      result.push({ rawTime: 0, mediaTime: 0 });
    }
  }

  return result;
}

function templateUrl(media: string, representation: Element, number: number, time: number): string {
  const values: Record<string, string | number> = {
    RepresentationID: representation.getAttribute('id') ?? '',
    Number: number,
    Time: time,
    Bandwidth: representation.getAttribute('bandwidth') ?? '',
  };

  return media.replace(/\$([A-Za-z]*)(?:(%0)([0-9]+)d)?\$/g, (match, name: string, padding: string, width: string) => {
    if (match === '$$') {
      return '$';
    }

    const value = values[name];
    if (value === undefined) {
      return match;
    }

    const stringValue = String(value);
    if (padding !== undefined && width !== undefined && name !== 'RepresentationID') {
      return stringValue.padStart(Number(width), '0');
    }

    return stringValue;
  });
}

function resolveBaseUrls(baseUrls: string[], element: Element): string[] {
  const childBaseUrls = directChildrenByLocalName(element, 'BaseURL')
    .map((baseUrl) => baseUrl.textContent?.trim() ?? '')
    .filter(Boolean);

  if (childBaseUrls.length === 0) {
    return baseUrls;
  }

  return baseUrls.flatMap((baseUrl) => childBaseUrls.map((childBaseUrl) => absoluteManifestUrl(baseUrl, childBaseUrl)));
}

function directChildrenByLocalName(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => child.localName === name);
}

function absoluteManifestUrl(baseUrl: string, value: string): string {
  return new URL(value, baseUrl).href;
}

function segmentUrlTail(url: string): string {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).slice(-4).join('/');
  } catch {
    return url.split('/').filter(Boolean).slice(-4).join('/');
  }
}

function positiveNumber(value: string | null): number | undefined {
  const number = numberFromString(value);
  return number === undefined || number <= 0 ? undefined : number;
}

function numberAttribute(element: Element, name: string): number | undefined {
  return numberFromString(element.getAttribute(name));
}

function numberFromString(value: string | null): number | undefined {
  if (value === null || value.trim() === '') {
    return undefined;
  }

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function extractLanguage(fallback: string, playlist: ParsedPlaylist, info: SubtitleGroupInfo): string {
  const candidates = [
    playlist.attributes?.LANGUAGE,
    playlist.attributes?.LANG,
    info.language,
    info.lang,
    fallback,
  ];

  const language = candidates.find(
    (candidate): candidate is string => typeof candidate === 'string' && isLanguageCode(candidate),
  );
  return canonicalLanguage(language ?? 'und');
}

function trackLabel(groupLabel: string, language: string): { label: string; genericLanguageLabel: boolean } {
  // mpd-parser stores Representation@id in playlist NAME. The subtitle-group
  // key is the semantic AdaptationSet Label (or its language fallback).
  const normalizedGroupLabel = groupLabel.trim();
  if (
    normalizedGroupLabel !== '' &&
    !isTechnicalLabel(normalizedGroupLabel) &&
    !isLanguageLabel(normalizedGroupLabel, language)
  ) {
    return { label: normalizedGroupLabel, genericLanguageLabel: true };
  }

  return { label: formatLanguage(language), genericLanguageLabel: true };
}

function formatLanguage(language: string): string {
  try {
    const locale = typeof navigator === 'undefined' ? 'en' : navigator.language;
    return new Intl.DisplayNames([locale], { type: 'language' }).of(language) ?? language;
  } catch {
    return language;
  }
}

function dedupeLabel(label: string, labelCounts: Map<string, number>): string {
  const count = labelCounts.get(label) ?? 0;
  labelCounts.set(label, count + 1);
  return count === 0 ? label : `${label} ${count + 1}`;
}

function groupEquivalentTracks(candidates: SubtitleTrackCandidate[]): SubtitleTrack[] {
  const tracks: SubtitleTrack[] = [];
  const trackIndexes = new Map<string, number>();

  for (const { genericKey, ...track } of candidates) {
    if (genericKey === undefined) {
      tracks.push(track);
      continue;
    }

    const groupingKey = genericKey;
    const existingIndex = trackIndexes.get(groupingKey);
    if (existingIndex === undefined) {
      trackIndexes.set(groupingKey, tracks.length);
      tracks.push(track);
      continue;
    }

    const existing = tracks[existingIndex];
    const variants = variantsForTrack(existing);
    const compatibleVariant = variants.find((variant) => canMergeSegments(variant.segments, track.segments));

    if (compatibleVariant === undefined) {
      variants.push({ segments: track.segments });
    } else {
      compatibleVariant.segments = mergeSegments(compatibleVariant.segments, track.segments);
    }

    const segments = variants[0]?.segments ?? existing.segments;
    tracks[existingIndex] = {
      ...existing,
      id: createTrackId(existing.language, existing.label),
      segments,
      variants: variants.length > 1 ? variants : undefined,
    };
  }

  return tracks;
}

function variantsForTrack(track: SubtitleTrack): SubtitleTrackVariant[] {
  if (track.variants !== undefined) {
    return track.variants.map((variant) => ({ segments: [...variant.segments] }));
  }

  return [{ segments: [...track.segments] }];
}

function canMergeSegments(left: SubtitleSegment[], right: SubtitleSegment[]): boolean {
  const leftRange = timelineRange(left);
  const rightRange = timelineRange(right);

  if (leftRange === undefined || rightRange === undefined) {
    return true;
  }

  return overlapRatio(leftRange, rightRange) < 0.2;
}

function mergeSegments(left: SubtitleSegment[], right: SubtitleSegment[]): SubtitleSegment[] {
  const indexedSegments = [...left, ...right].map((segment, index) => ({ segment, index }));
  const seenUrls = new Set<string>();
  const deduped = indexedSegments.filter(({ segment }) => {
    if (seenUrls.has(segment.url)) {
      return false;
    }
    seenUrls.add(segment.url);
    return true;
  });

  if (deduped.every(({ segment }) => segment.presentationTime !== undefined)) {
    deduped.sort(
      (leftItem, rightItem) =>
        (leftItem.segment.presentationTime ?? 0) - (rightItem.segment.presentationTime ?? 0) ||
        leftItem.segment.url.localeCompare(rightItem.segment.url) ||
        leftItem.index - rightItem.index,
    );
  }

  return deduped.map(({ segment }) => segment);
}

function timelineRange(segments: SubtitleSegment[]): TimelineRange | undefined {
  const timedSegments = segments.filter(
    (segment): segment is SubtitleSegment & { presentationTime: number } => segment.presentationTime !== undefined,
  );

  if (timedSegments.length === 0) {
    return undefined;
  }

  return timedSegments.reduce<TimelineRange>(
    (range, segment) => ({
      start: Math.min(range.start, segment.presentationTime),
      end: Math.max(range.end, segment.presentationTime + (segment.duration ?? 0)),
    }),
    { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY },
  );
}

function overlapRatio(left: TimelineRange, right: TimelineRange): number {
  const overlap = Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));
  const shorterDuration = Math.min(left.end - left.start, right.end - right.start);
  return shorterDuration <= 0 ? 0 : overlap / shorterDuration;
}

function dedupeFinalLabels(tracks: SubtitleTrack[]): SubtitleTrack[] {
  const labelCounts = new Map<string, number>();
  return tracks.map((track) => {
    const label = dedupeLabel(track.label, labelCounts);
    return {
      ...track,
      id: label === track.label ? track.id : createTrackId(track.language, label),
      label,
    };
  });
}

function isTechnicalLabel(value: string): boolean {
  const normalized = value.trim();
  return (
    /^t\d+(?:\s+\d+)?$/i.test(normalized) ||
    /^[{]?[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}[}]?$/i.test(normalized)
  );
}

function isLanguageLabel(label: string, language: string): boolean {
  if (!isLanguageCode(label)) {
    return false;
  }

  return canonicalLanguage(label) === canonicalLanguage(language);
}

function isLanguageCode(value: string): boolean {
  return /^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(value.trim()) && !isTechnicalLabel(value);
}

function isEmptySubtitlePlaceholderUrl(url: string): boolean {
  try {
    return /(?:^|\/)empty-dash-subs\.vtt$/i.test(new URL(url).pathname);
  } catch {
    return /(?:^|\/)empty-dash-subs\.vtt(?:[?#]|$)/i.test(url);
  }
}

function canonicalLanguage(language: string): string {
  const normalized = language.trim().replace('_', '-').toLowerCase();

  if (
    normalized.startsWith('zh-hans') ||
    normalized === 'zh-cn' ||
    normalized === 'zh-sg' ||
    normalized.startsWith('cmn-hans')
  ) {
    return 'zh-Hans';
  }

  if (
    normalized.startsWith('zh-hant') ||
    normalized === 'zh-tw' ||
    normalized === 'zh-hk' ||
    normalized === 'zh-mo' ||
    normalized.startsWith('cmn-hant') ||
    normalized.startsWith('yue-hant')
  ) {
    return 'zh-Hant';
  }

  return normalized;
}

function createTrackId(language: string, label: string): string {
  const key = `${language}\n${label}`;
  let hash = 2166136261;

  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `track-${(hash >>> 0).toString(36)}`;
}
