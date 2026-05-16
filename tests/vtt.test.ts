import { describe, expect, it } from 'vitest';
import { parseSegmentedWebVtt, parseSegmentedWebVttWithTiming, parseTimestamp, parseWebVtt } from '../src/vtt';

describe('parseTimestamp', () => {
  it('parses WebVTT timestamps', () => {
    expect(parseTimestamp('00:01:02.500')).toBe(62.5);
    expect(parseTimestamp('01:02.500')).toBe(62.5);
  });
});

describe('parseWebVtt', () => {
  it('parses cue text and strips WebVTT markup', () => {
    const cues = parseWebVtt(`WEBVTT

1
00:00:01.000 --> 00:00:03.500 align:center
<v Narrator>Hello &amp; welcome<br>朋友
`);

    expect(cues).toEqual([{ start: 1, end: 3.5, text: 'Hello & welcome\n朋友' }]);
  });

  it('applies WebVTT timestamp maps', () => {
    const cues = parseWebVtt(`WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:03.000
mapped
`);

    expect(cues).toEqual([{ start: 11, end: 13, text: 'mapped' }]);
  });

  it('ignores notes and invalid cues', () => {
    const cues = parseWebVtt(`WEBVTT

NOTE this is metadata
not a cue

bad
00:00:04.000 --> 00:00:02.000
skip me

00:00:05.000 --> 00:00:06.000
keep me
`);

    expect(cues).toEqual([{ start: 5, end: 6, text: 'keep me' }]);
  });
});

describe('parseSegmentedWebVtt', () => {
  it('aligns relative cues to DASH presentation time', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 5,
        presentationTime: 10,
        text: `WEBVTT

00:00:01.000 --> 00:00:02.000
first
`,
      },
      {
        duration: 5,
        presentationTime: 17,
        text: `WEBVTT

00:00:01.000 --> 00:00:03.000
second
`,
      },
    ]);

    expect(cues).toEqual([
      { start: 11, end: 12, text: 'first' },
      { start: 18, end: 20, text: 'second' },
    ]);
  });

  it('normalizes very large media presentation timestamps against the first subtitle segment', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 5,
        presentationTime: 90_000,
        text: `WEBVTT

00:00:01.000 --> 00:00:02.000
first
`,
      },
      {
        duration: 5,
        presentationTime: 90_007,
        text: `WEBVTT

00:00:01.000 --> 00:00:03.000
second
`,
      },
    ]);

    expect(cues).toEqual([
      { start: 1, end: 2, text: 'first' },
      { start: 8, end: 10, text: 'second' },
    ]);
  });

  it('leaves absolute segment cue times alone', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 5,
        text: `WEBVTT

00:00:01.000 --> 00:00:02.000
first
`,
      },
      {
        duration: 5,
        text: `WEBVTT

00:00:11.000 --> 00:00:13.000
second
`,
      },
    ]);

    expect(cues).toEqual([
      { start: 1, end: 2, text: 'first' },
      { start: 11, end: 13, text: 'second' },
    ]);
  });

  it('leaves absolute cue times alone when MPD presentation time is present', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 5,
        presentationTime: 10,
        text: `WEBVTT

00:00:12.000 --> 00:00:13.000
first
`,
      },
      {
        duration: 5,
        presentationTime: 17,
        text: `WEBVTT

00:00:18.000 --> 00:00:20.000
second
`,
      },
    ]);

    expect(cues).toEqual([
      { start: 12, end: 13, text: 'first' },
      { start: 18, end: 20, text: 'second' },
    ]);
  });

  it('does not double-apply presentation time when WebVTT timestamp maps already made cues absolute', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 30,
        presentationTime: 10,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:03.000
mapped
`,
      },
    ]);

    expect(cues).toEqual([{ start: 11, end: 13, text: 'mapped' }]);
  });

  it('uses MPD presentation time over WebVTT timestamp maps for segmented cues', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 30,
        presentationTime: 120,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:900000

00:00:01.000 --> 00:00:03.000
mapped
`,
      },
    ]);

    expect(cues).toEqual([{ start: 121, end: 123, text: 'mapped' }]);
  });

  it('does not offset full-document VTT cues that also include timestamp maps', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 4,
        presentationTime: 1322,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

00:23:01.047 --> 00:23:02.799
full document cue
`,
      },
    ]);

    expect(cues).toEqual([{ start: 1381.047, end: 1382.799, text: 'full document cue' }]);
  });

  it('applies MPD period offset to HBO media-timeline VTT cues', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 748.122,
        mediaTime: 1874.497,
        presentationTime: 1914.456,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:0

00:39:39.687 --> 00:39:43.690
Like, right now, in front of--
in front of these two?
`,
      },
    ]);

    expect(cues).toEqual([
      {
        start: 2419.646,
        end: 2423.649,
        text: 'Like, right now, in front of--\nin front of these two?',
      },
    ]);
  });

  it('normalizes huge WebVTT timestamp maps when MPD presentation time is absent', () => {
    const cues = parseSegmentedWebVtt([
      {
        duration: 5,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:9000000000

00:00:01.000 --> 00:00:02.000
first
`,
      },
      {
        duration: 5,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:9000630000

00:00:01.000 --> 00:00:02.000
second
`,
      },
    ]);

    expect(cues).toEqual([
      { start: 1, end: 2, text: 'first' },
      { start: 8, end: 9, text: 'second' },
    ]);
  });

  it('keeps huge presentation-time origins stable across seek windows', () => {
    const firstWindow = parseSegmentedWebVttWithTiming([
      {
        duration: 5,
        presentationTime: 90_000,
        text: `WEBVTT

00:00:01.000 --> 00:00:02.000
first
`,
      },
    ]);
    const secondWindow = parseSegmentedWebVttWithTiming(
      [
        {
          duration: 5,
          presentationTime: 90_100,
          text: `WEBVTT

00:00:01.000 --> 00:00:02.000
second
`,
        },
      ],
      firstWindow.timing,
    );

    expect(firstWindow.cues).toEqual([{ start: 1, end: 2, text: 'first' }]);
    expect(secondWindow.cues).toEqual([{ start: 101, end: 102, text: 'second' }]);
  });

  it('keeps huge WebVTT timestamp-map origins stable across seek windows', () => {
    const firstWindow = parseSegmentedWebVttWithTiming([
      {
        duration: 5,
        text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:9000000000

00:00:01.000 --> 00:00:02.000
first
`,
      },
    ]);
    const secondWindow = parseSegmentedWebVttWithTiming(
      [
        {
          duration: 5,
          text: `WEBVTT
X-TIMESTAMP-MAP=LOCAL:00:00:00.000,MPEGTS:9009000000

00:00:01.000 --> 00:00:02.000
second
`,
        },
      ],
      firstWindow.timing,
    );

    expect(firstWindow.cues).toEqual([{ start: 1, end: 2, text: 'first' }]);
    expect(secondWindow.cues).toEqual([{ start: 101, end: 102, text: 'second' }]);
  });
});
