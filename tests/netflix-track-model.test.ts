import { describe, expect, it } from 'vitest';
import {
  extractNetflixTrackResource,
  extractNetflixManifestResources,
  findNetflixTrackForSelection,
  netflixTrackIds,
  normalizeNetflixPlayerTracks,
} from '../src/netflix/track-model';

describe('normalizeNetflixPlayerTracks', () => {
  it('filters off and image tracks while preserving subtitle kinds', () => {
    expect(
      normalizeNetflixPlayerTracks([
        { trackId: 'none', displayName: '關閉', isNoneTrack: true, bcp47: null },
        { trackId: 'plain', displayName: 'English', bcp47: 'en', rawTrackType: 'SUBTITLES' },
        { trackId: 'cc', displayName: 'English', bcp47: 'en', rawTrackType: 'closedcaptions' },
        { trackId: 'forced', displayName: '日本語', bcp47: 'ja', isForcedNarrative: true },
        { trackId: 'image', displayName: 'Image', bcp47: 'ja', isImageBased: true },
      ]),
    ).toEqual([
      { id: 'plain', label: 'English', language: 'en', kind: 'subtitles' },
      { id: 'cc', label: 'English [CC]', language: 'en', kind: 'captions' },
      { id: 'forced', label: '日本語 [Forced]', language: 'ja', kind: 'forced' },
    ]);
  });

  it('accepts the legacy Netflix track id and language fields', () => {
    expect(
      normalizeNetflixPlayerTracks([
        {
          new_track_id: 'T:legacy',
          languageDescription: '繁體中文',
          language: 'zh-Hant',
          rawTrackType: 'SUBTITLES',
        },
      ]),
    ).toEqual([{ id: 'T:legacy', label: '繁體中文', language: 'zh-Hant', kind: 'subtitles' }]);
  });
});

describe('netflixTrackIds', () => {
  it('collects and de-duplicates current, generic, and legacy id aliases', () => {
    expect(netflixTrackIds({ trackId: 12, id: 'manifest-id', new_track_id: 'manifest-id' }))
      .toEqual(['12', 'manifest-id']);
  });

  it('extracts a direct downloadable resource through legacy aliases', () => {
    expect(extractNetflixTrackResource({
      new_track_id: 'legacy-id',
      ttDownloadables: {
        'dfxp-ls-sdh': { downloadUrls: { main: 'https://cdn.example/subtitle' } },
      },
    })).toEqual({
      trackIds: ['legacy-id'],
      profile: 'dfxp-ls-sdh',
      urls: ['https://cdn.example/subtitle'],
    });
  });
});

describe('findNetflixTrackForSelection', () => {
  const tracks = [
    { id: 'new-plain', label: 'English', language: 'en', kind: 'subtitles' as const },
    { id: 'new-cc', label: 'English [CC]', language: 'en', kind: 'captions' as const },
  ];

  it('prefers an exact runtime id', () => {
    expect(findNetflixTrackForSelection(tracks, { trackId: 'new-cc', language: 'en', kind: 'subtitles' })?.id).toBe(
      'new-cc',
    );
  });

  it('restores by BCP-47 and kind when a new title has different ids', () => {
    expect(findNetflixTrackForSelection(tracks, { trackId: 'old', language: 'en', kind: 'captions' })?.id).toBe(
      'new-cc',
    );
  });
});

describe('extractNetflixManifestResources', () => {
  it('supports current camelCase manifest aliases and prefers IMSC text', () => {
    const result = extractNetflixManifestResources({
      result: {
        movieId: 123,
        textTracks: [
          {
            id: 'T:current',
            downloadables: {
              'nflx-cmisc': { isImage: true, urls: [{ url: 'https://cdn.example/image' }] },
              'dfxp-ls-sdh': { urls: [{ url: 'https://cdn.example/dfxp' }] },
              'imsc1.1': { downloadUrls: { a: 'https://cdn.example/imsc' } },
            },
          },
        ],
      },
    });

    expect(result).toEqual({
      mediaId: '123',
      resources: [
        {
          trackIds: ['T:current'],
          profile: 'imsc1.1',
          urls: ['https://cdn.example/imsc'],
        },
      ],
    });
  });

  it('supports legacy timedtexttracks and ttDownloadables fields', () => {
    const result = extractNetflixManifestResources({
      result: {
        movieId: '456',
        timedtexttracks: [
          {
            new_track_id: 'T:legacy',
            ttDownloadables: {
              'dfxp-ls-sdh': { downloadUrls: { first: 'https://cdn.example/legacy' } },
            },
          },
        ],
      },
    });

    expect(result?.resources[0]).toEqual({
      trackIds: ['T:legacy'],
      profile: 'dfxp-ls-sdh',
      urls: ['https://cdn.example/legacy'],
    });
  });
});
