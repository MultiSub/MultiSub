import { describe, expect, it } from 'vitest';
import { extractSubtitleTracksFromMpd, extractSubtitleTracksFromParsedManifest } from '../src/mpd';

describe('extractSubtitleTracksFromParsedManifest', () => {
  it('extracts subtitle tracks from DASH MPD text', () => {
    const tracks = extractSubtitleTracksFromMpd(
      `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT10S">
        <Period duration="PT10S">
          <AdaptationSet mimeType="text/vtt" lang="en">
            <Representation id="subtitle_001" bandwidth="256">
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
        label: 'English',
        language: 'en',
        segments: [
          { url: 'https://cdn.example/path/subtitles/en/1.vtt', duration: 5, presentationTime: 0 },
          { url: 'https://cdn.example/path/subtitles/en/2.vtt', duration: 5, presentationTime: 5 },
        ],
      },
    ]);
  });

  it('drops HBO empty placeholder tracks and never exposes UUID representation ids', () => {
    const tracks = extractSubtitleTracksFromMpd(
      `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT20S">
        <Period duration="PT20S">
          <AdaptationSet contentType="text" mimeType="text/vtt" lang="en-US">
            <Label>en-US CC</Label>
            <Representation id="f31dc6e1-79a8-4caa-b11b-8d7ef5678251" bandwidth="1">
              <BaseURL>https://cdn.example/gmss/subtitle/empty-dash-subs.vtt</BaseURL>
            </Representation>
          </AdaptationSet>
          <AdaptationSet contentType="text" mimeType="text/vtt" lang="en-US">
            <Label>en-US CC</Label>
            <Representation id="t0" bandwidth="256">
              <BaseURL>subtitles/en/</BaseURL>
              <SegmentTemplate timescale="1" media="$Number$.vtt" startNumber="1" duration="10" />
            </Representation>
          </AdaptationSet>
          <AdaptationSet contentType="text" mimeType="text/vtt" lang="zh-Hans-SG">
            <Representation id="3c62171c-7f21-4b3f-9d52-94d88fe12f62" bandwidth="256">
              <BaseURL>subtitles/zh/</BaseURL>
              <SegmentTemplate timescale="1" media="$Number$.vtt" startNumber="1" duration="10" />
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>`,
      'https://cdn.example/path/master.mpd',
    );

    expect(tracks).toMatchObject([
      {
        label: 'en-US CC',
        language: 'en-us',
        segments: [
          { url: 'https://cdn.example/path/subtitles/en/1.vtt' },
          { url: 'https://cdn.example/path/subtitles/en/2.vtt' },
        ],
      },
      {
        label: 'Simplified Chinese',
        language: 'zh-Hans',
        segments: [
          { url: 'https://cdn.example/path/subtitles/zh/1.vtt' },
          { url: 'https://cdn.example/path/subtitles/zh/2.vtt' },
        ],
      },
    ]);
    expect(tracks.flatMap((track) => track.segments).some((segment) => segment.url.includes('empty-dash-subs'))).toBe(false);
    expect(tracks.some((track) => /[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}/i.test(track.label))).toBe(false);
  });

  it('uses an unknown language fallback when every parsed identifier is a UUID', () => {
    const uuid = 'f31dc6e1-79a8-4caa-b11b-8d7ef5678251';
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            [uuid]: {
              playlists: [
                {
                  attributes: { NAME: uuid },
                  segments: [{ resolvedUri: 'https://cdn.example/unknown/1.vtt', duration: 4 }],
                },
              ],
            },
          },
        },
      },
    });

    expect(tracks).toHaveLength(1);
    expect(tracks[0].language).toBe('und');
    expect(tracks[0].label).not.toContain(uuid);
  });

  it('groups representation ids under readable language labels', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              playlists: [
                {
                  attributes: { NAME: 'subtitle_en_001' },
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
                  attributes: { NAME: 'subtitle_zh_001' },
                  segments: [{ resolvedUri: 'https://cdn.example/zh-hans/0001.vtt', duration: 4 }],
                },
                {
                  attributes: { NAME: 'subtitle_zh_002' },
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
        label: 'Simplified Chinese',
        language: 'zh-Hans',
        segments: [
          { url: 'https://cdn.example/zh-hans/0001.vtt', duration: 4 },
          { url: 'https://cdn.example/zh-hant/0001.vtt', duration: 4 },
        ],
      },
    ]);
    expect(new Set(tracks.map((track) => track.id)).size).toBe(2);
  });

  it('merges the same semantic track across periods with different representation ids', () => {
    const tracks = extractSubtitleTracksFromMpd(
      `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT20S">
        <Period start="PT0S" duration="PT10S">
          <AdaptationSet contentType="text" mimeType="text/vtt" lang="en-US">
            <Label>English CC</Label>
            <Representation id="subtitle_001" bandwidth="256">
              <BaseURL>period-1/</BaseURL>
              <SegmentTemplate timescale="1" media="$Number$.vtt" startNumber="1" duration="10" />
            </Representation>
          </AdaptationSet>
        </Period>
        <Period start="PT10S" duration="PT10S">
          <AdaptationSet contentType="text" mimeType="text/vtt" lang="en-US">
            <Label>English CC</Label>
            <Representation id="subtitle_002" bandwidth="256">
              <BaseURL>period-2/</BaseURL>
              <SegmentTemplate timescale="1" media="$Number$.vtt" startNumber="1" duration="10" />
            </Representation>
          </AdaptationSet>
        </Period>
      </MPD>`,
      'https://cdn.example/path/master.mpd',
    );

    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      label: 'English CC',
      language: 'en-us',
      segments: [
        { url: 'https://cdn.example/path/period-1/1.vtt' },
        { url: 'https://cdn.example/path/period-2/1.vtt' },
      ],
    });
  });

  it('ignores blank resolved subtitle urls', () => {
    const tracks = extractSubtitleTracksFromParsedManifest({
      mediaGroups: {
        SUBTITLES: {
          subs: {
            en: {
              playlists: [{ attributes: { NAME: 'subtitle_001' }, resolvedUri: '   ', segments: [] }],
            },
          },
        },
      },
    });

    expect(tracks).toEqual([]);
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
