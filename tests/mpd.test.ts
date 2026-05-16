import { describe, expect, it } from 'vitest';
import { extractSubtitleTracksFromMpd, extractSubtitleTracksFromParsedManifest } from '../src/mpd';

describe('extractSubtitleTracksFromParsedManifest', () => {
  it('extracts subtitle tracks from DASH MPD text', () => {
    const tracks = extractSubtitleTracksFromMpd(
      `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S">
        <Period duration="PT10S">
          <AdaptationSet mimeType="text/vtt" lang="en">
            <Representation id="sub-en" bandwidth="256">
              <BaseURL>subtitles/en/</BaseURL>
              <SegmentTemplate timescale="1" media="$Number$.vtt" startNumber="1" duration="5" />
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>`,
      'https://cdn.example/path/master.mpd',
    );

    expect(tracks).toMatchObject([
      {
        label: 'sub-en',
        language: 'en',
        segments: [
          { url: 'https://cdn.example/path/subtitles/en/1.vtt', duration: 5, presentationTime: 0 },
          { url: 'https://cdn.example/path/subtitles/en/2.vtt', duration: 5, presentationTime: 5 },
        ],
      },
    ]);
  });

  it('extracts subtitle playlists and deduplicates labels', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              playlists: [
                {
                  attributes: { NAME: 'English' },
                  resolvedUri: 'https://cdn.example/en/playlist.m3u8',
                  segments: [
                    { resolvedUri: 'https://cdn.example/en/0001.vtt', duration: 4 },
                    { resolvedUri: 'https://cdn.example/en/0002.vtt', duration: 4 },
                  ],
                },
              ],
            },
            'zh-Hans': {
              playlists: [
                {
                  attributes: { NAME: 'Chinese' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh-hans/0001.vtt', duration: 4 }],
                },
                {
                  attributes: { NAME: 'Chinese' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh-hant/0001.vtt', duration: 4 }],
                },
              ],
            },
          },
        },
      },
    });

    expect(tracks).toMatchObject([
      {
        label: 'English',
        language: 'en',
        segments: [
          { url: 'https://cdn.example/en/0001.vtt', duration: 4 },
          { url: 'https://cdn.example/en/0002.vtt', duration: 4 },
        ],
      },
      {
        label: 'Chinese',
        language: 'zh-Hans',
        segments: [{ url: 'https://cdn.example/zh-hans/0001.vtt', duration: 4 }],
      },
      {
        label: 'Chinese 2',
        language: 'zh-Hans',
        segments: [{ url: 'https://cdn.example/zh-hant/0001.vtt', duration: 4 }],
      },
    ]);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(3);
  });

  it('merges technical HBO duplicate playlists into one readable language track', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              language: 'en',
              playlists: [
                {
                  attributes: { NAME: 't0' },
                  segments: [{ resolvedUri: 'https://cdn.example/en/0001.vtt', duration: 4 }],
                },
                {
                  attributes: { NAME: 't0' },
                  segments: [
                    { resolvedUri: 'https://cdn.example/en/0002.vtt', duration: 4 },
                    { resolvedUri: 'https://cdn.example/en/0003.vtt', duration: 4 },
                  ],
                },
              ],
            },
            'zh-Hans': {
              language: 'zh-Hans',
              playlists: [
                {
                  attributes: { NAME: 't2' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh/0001.vtt', duration: 4 }],
                },
              ],
            },
          },
        },
      },
    });

    expect(tracks).toMatchObject([
      {
        label: 'English',
        language: 'en',
        segments: [
          { url: 'https://cdn.example/en/0001.vtt', duration: 4 },
          { url: 'https://cdn.example/en/0002.vtt', duration: 4 },
          { url: 'https://cdn.example/en/0003.vtt', duration: 4 },
        ],
      },
      { label: 'Simplified Chinese', language: 'zh-Hans' },
    ]);
  });

  it('keeps overlapping technical HBO duplicates as hidden variants', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              language: 'en',
              playlists: [
                {
                  attributes: { NAME: 't0' },
                  segments: [
                    { resolvedUri: 'https://cdn.example/en-a/0001.vtt', duration: 4, presentationTime: 0 },
                    { resolvedUri: 'https://cdn.example/en-a/0002.vtt', duration: 4, presentationTime: 4 },
                  ],
                },
                {
                  attributes: { NAME: 't0' },
                  segments: [
                    { resolvedUri: 'https://cdn.example/en-b/0001.vtt', duration: 4, presentationTime: 0 },
                    { resolvedUri: 'https://cdn.example/en-b/0002.vtt', duration: 4, presentationTime: 4 },
                  ],
                },
              ],
            },
          },
        },
      },
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      label: 'English',
      language: 'en',
      segments: [
        { url: 'https://cdn.example/en-a/0001.vtt' },
        { url: 'https://cdn.example/en-a/0002.vtt' },
      ],
      variants: [
        {
          segments: [
            { url: 'https://cdn.example/en-a/0001.vtt' },
            { url: 'https://cdn.example/en-a/0002.vtt' },
          ],
        },
        {
          segments: [
            { url: 'https://cdn.example/en-b/0001.vtt' },
            { url: 'https://cdn.example/en-b/0002.vtt' },
          ],
        },
      ],
    });
  });

  it('canonicalizes regional Chinese language codes before grouping variants', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            'cmn-Hant-TW': {
              language: 'cmn-Hant-TW',
              playlists: [
                {
                  attributes: { NAME: 't4' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh-tw/0001.vtt', duration: 4, presentationTime: 0 }],
                },
              ],
            },
            'zh-Hant-HK': {
              language: 'zh-Hant-HK',
              playlists: [
                {
                  attributes: { NAME: 't4' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh-hk/0001.vtt', duration: 4, presentationTime: 0 }],
                },
              ],
            },
          },
        },
      },
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      label: 'Traditional Chinese',
      language: 'zh-Hant',
      variants: [
        { segments: [{ url: 'https://cdn.example/zh-tw/0001.vtt' }] },
        { segments: [{ url: 'https://cdn.example/zh-hk/0001.vtt' }] },
      ],
    });
  });

  it('keeps track ids stable when subtitle segment URLs change after seeking', () => {
    const firstWindow = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              language: 'en',
              playlists: [
                {
                  attributes: { NAME: 't0' },
                  segments: [{ resolvedUri: 'https://cdn.example/window-a/en/0001.vtt', duration: 4 }],
                },
              ],
            },
          },
        },
      },
    });
    const secondWindow = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              language: 'en',
              playlists: [
                {
                  attributes: { NAME: 't0' },
                  segments: [{ resolvedUri: 'https://cdn.example/window-b/en/0088.vtt', duration: 4 }],
                },
              ],
            },
          },
        },
      },
    });

    expect(firstWindow[0].id).toBe(secondWindow[0].id);
  });
});
