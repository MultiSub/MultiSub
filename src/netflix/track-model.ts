import type { NetflixSubtitleKind, NetflixSubtitleTrack } from './messages';

export interface StoredNetflixSelection {
  trackId: string | null;
  language: string | null;
  kind: NetflixSubtitleKind | null;
}

export interface NetflixAvailabilityState {
  mediaId: string | null;
  currentTrackId: string | null;
  selectedTrackId: string | null;
  tracks: NetflixSubtitleTrack[];
}

export interface NetflixTrackResource {
  trackIds: string[];
  profile: string;
  urls: string[];
}

export interface NetflixManifestResources {
  mediaId: string;
  resources: NetflixTrackResource[];
}

const TEXT_PROFILE_PREFERENCE = [
  'imsc1.1',
  'dfxp-ls-sdh',
  'simplesdh',
  'webvtt-lssdh-ios8',
];

export function normalizeNetflixPlayerTracks(value: unknown): NetflixSubtitleTrack[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tracks = value
    .map(normalizeNetflixPlayerTrack)
    .filter((track): track is NetflixSubtitleTrack => track !== undefined);
  const seenIds = new Set<string>();
  return tracks.filter((track) => {
    if (seenIds.has(track.id)) {
      return false;
    }
    seenIds.add(track.id);
    return true;
  });
}

export function netflixTrackId(value: unknown): string | undefined {
  return netflixTrackIds(value)[0];
}

export function netflixTrackIds(value: unknown): string[] {
  const track = asRecord(value);
  if (track === undefined) {
    return [];
  }

  return [track.trackId, track.id, track.new_track_id]
    .map(stringId)
    .filter((id): id is string => id !== undefined && id !== '')
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

export function findNetflixTrackForSelection(
  tracks: NetflixSubtitleTrack[],
  selection: StoredNetflixSelection,
): NetflixSubtitleTrack | undefined {
  if (selection.trackId !== null) {
    const exact = tracks.find((track) => track.id === selection.trackId);
    if (exact !== undefined) {
      return exact;
    }
  }

  if (selection.language === null) {
    return undefined;
  }

  return (
    tracks.find((track) => track.language === selection.language && track.kind === selection.kind) ??
    tracks.find((track) => track.language === selection.language)
  );
}

export function extractNetflixManifestResources(value: unknown): NetflixManifestResources | undefined {
  const root = asRecord(value);
  const result = asRecord(root?.result) ?? root;
  const mediaId = stringId(result?.movieId);
  const textTracks = result?.textTracks ?? result?.timedtexttracks;
  if (mediaId === undefined || !Array.isArray(textTracks)) {
    return undefined;
  }

  const resources = textTracks
    .map(extractNetflixTrackResource)
    .filter((resource): resource is NetflixTrackResource => resource !== undefined);
  return { mediaId, resources };
}

function normalizeNetflixPlayerTrack(value: unknown): NetflixSubtitleTrack | undefined {
  const track = asRecord(value);
  if (track === undefined || isNoneTrack(track) || track.isImageBased === true) {
    return undefined;
  }

  const id = netflixTrackId(track);
  const language = firstString(track.bcp47, track.language);
  const baseLabel = firstString(track.displayName, track.languageDescription, language);
  if (id === undefined || language === undefined || baseLabel === undefined) {
    return undefined;
  }

  const kind = subtitleKind(track);
  return {
    id,
    language,
    kind,
    label: withKindSuffix(baseLabel, kind),
  };
}

export function extractNetflixTrackResource(value: unknown): NetflixTrackResource | undefined {
  const track = asRecord(value);
  if (track === undefined || isNoneTrack(track)) {
    return undefined;
  }

  const trackIds = netflixTrackIds(track);
  if (trackIds.length === 0) {
    return undefined;
  }

  const downloadables = asRecord(track.downloadables) ?? asRecord(track.ttDownloadables);
  if (downloadables === undefined) {
    return undefined;
  }

  const candidates = Object.entries(downloadables)
    .map(([profile, raw]) => ({ profile, downloadable: asRecord(raw) }))
    .filter(
      (candidate): candidate is { profile: string; downloadable: Record<string, unknown> } =>
        candidate.downloadable !== undefined &&
        candidate.downloadable.isImage !== true &&
        !/image|nflx-cmisc/i.test(candidate.profile),
    )
    .map(({ profile, downloadable }) => ({ profile, urls: downloadableUrls(downloadable) }))
    .filter((candidate) => candidate.urls.length > 0)
    .sort((left, right) => profileRank(left.profile) - profileRank(right.profile));

  const selected = candidates[0];
  return selected === undefined ? undefined : { trackIds, ...selected };
}

function subtitleKind(track: Record<string, unknown>): NetflixSubtitleKind {
  if (track.isForcedNarrative === true || track.forced === true) {
    return 'forced';
  }

  const descriptor = [track.rawTrackType, track.subType, track.trackType, track.variant]
    .filter((part): part is string => typeof part === 'string')
    .join(' ');
  return /closed\s*captions?|captions?|\bcc\b|sdh/i.test(descriptor) ? 'captions' : 'subtitles';
}

function withKindSuffix(label: string, kind: NetflixSubtitleKind): string {
  if (kind === 'captions' && !/\b(?:cc|sdh)\b/i.test(label)) {
    return `${label} [CC]`;
  }
  if (kind === 'forced' && !/forced/i.test(label)) {
    return `${label} [Forced]`;
  }
  return label;
}

function isNoneTrack(track: Record<string, unknown>): boolean {
  if (track.isNoneTrack === true || (typeof track.rank === 'number' && track.rank < 0)) {
    return true;
  }

  const label = firstString(track.displayName, track.languageDescription);
  if (label !== undefined && /^(?:off|none|關閉|关闭)$/i.test(label.trim())) {
    return true;
  }

  const id = netflixTrackId(track);
  return id?.split(';')[4] === '1';
}

function downloadableUrls(downloadable: Record<string, unknown>): string[] {
  const values: unknown[] = [];
  const downloadUrls = asRecord(downloadable.downloadUrls);
  if (downloadUrls !== undefined) {
    values.push(...Object.values(downloadUrls));
  }
  if (Array.isArray(downloadable.urls)) {
    values.push(...downloadable.urls);
  }

  return values
    .map((value) => (typeof value === 'string' ? value : firstString(asRecord(value)?.url)))
    .filter((value): value is string => value !== undefined && /^https:\/\//i.test(value))
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

function profileRank(profile: string): number {
  const index = TEXT_PROFILE_PREFERENCE.findIndex((preferred) => profile.toLowerCase().includes(preferred));
  return index === -1 ? TEXT_PROFILE_PREFERENCE.length : index;
}

function stringId(value: unknown): string | undefined {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value !== '');
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}
