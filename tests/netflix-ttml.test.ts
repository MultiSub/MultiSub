import { describe, expect, it } from 'vitest';
import { parseNetflixTtml } from '../src/netflix/ttml';

describe('parseNetflixTtml', () => {
  it('uses the document tick rate and preserves plain cue text', () => {
    const cues = parseNetflixTtml(`<?xml version="1.0" encoding="UTF-8"?>
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000">
  <body><div>
    <p begin="10000000t" end="32505000t">Hello <span>Netflix</span></p>
  </div></body>
</tt>`);

    expect(cues).toEqual([{ start: 1, end: 3.251, text: 'Hello Netflix' }]);
  });

  it('supports clock times, duration, and h/m/s/ms offsets', () => {
    const cues = parseNetflixTtml(`<tt><body><div>
      <p begin="1h" dur="500ms">hour</p>
      <p begin="1m" end="61.25s">minute</p>
      <p begin="00:01:02.345" dur="1.005s">clock</p>
    </div></body></tt>`);

    expect(cues).toEqual([
      { start: 60, end: 61.25, text: 'minute' },
      { start: 62.345, end: 63.35, text: 'clock' },
      { start: 3600, end: 3600.5, text: 'hour' },
    ]);
  });

  it('applies frameRateMultiplier to frame offsets and frame clock times', () => {
    const cues = parseNetflixTtml(`<tt xmlns:ttp="urn:ttml:parameter"
      ttp:frameRate="24" ttp:frameRateMultiplier="1000 1001">
      <body><div>
        <p begin="24f" dur="12f">offset frames</p>
        <p begin="00:00:02:12" end="00:00:03:00">clock frames</p>
      </div></body>
    </tt>`);

    expect(cues).toEqual([
      { start: 1.001, end: 1.502, text: 'offset frames' },
      { start: 2.501, end: 3, text: 'clock frames' },
    ]);
  });

  it('turns br elements into line breaks, decodes entities, and omits ruby annotations', () => {
    const cues = parseNetflixTtml(`<tt xmlns:tts="urn:ttml:style"><head><styling>
      <style xml:id="rubyText" tts:ruby="text" />
    </styling></head><body><div>
      <p begin="0s" end="2s">Tom &amp; Jerry<br/>漢<span tts:ruby="text">かん</span>字<rt>じ</rt><span style="rubyText">annotation</span> &#x1F44B;</p>
    </div></body></tt>`);

    expect(cues).toEqual([{ start: 0, end: 2, text: 'Tom & Jerry\n漢字 👋' }]);
  });

  it('supports namespace-prefixed paragraph and line-break elements', () => {
    const cues = parseNetflixTtml(`<tt:tt xmlns:tt="urn:ttml"><tt:body><tt:div>
      <tt:p begin="250ms" dur="1s">first<tt:br />second</tt:p>
    </tt:div></tt:body></tt:tt>`);

    expect(cues).toEqual([{ start: 0.25, end: 1.25, text: 'first\nsecond' }]);
  });

  it('drops malformed, empty, reversed, and sub-millisecond cues', () => {
    const cues = parseNetflixTtml(`<tt xmlns:tts="urn:ttml:style"><body><div>
      <p begin="later" end="2s">bad start</p>
      <p begin="3s" end="2s">reversed</p>
      <p begin="1s">missing end</p>
      <p begin="1s" dur="0s">zero duration</p>
      <p begin="1s" end="invalid" dur="2s">invalid explicit end</p>
      <p begin="1.0001s" end="1.0004s">rounds to nothing</p>
      <p begin="2s" end="3s"><span tts:ruby="text">annotation only</span></p>
      <p begin="4s" dur="1s">keep me</p>
    </div></body></tt>`);

    expect(cues).toEqual([{ start: 4, end: 5, text: 'keep me' }]);
  });
});
