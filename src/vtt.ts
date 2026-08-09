import type { SubtitleCue } from './messages';

export interface VttSegmentInput {
  text: string;
  duration?: number;
  presentationTime?: number;
  mediaTime?: number;
}

export interface SegmentedWebVttTiming {
  presentationTimeOrigin?: number;
  timestampMapOrigin?: number;
}

export interface SegmentedWebVttParseResult {
  cues: SubtitleCue[];
  timing: SegmentedWebVttTiming;
}

interface ParsedWebVtt {
  cues: SubtitleCue[];
  timestampMap?: WebVttTimestampMap;
}

interface WebVttTimestampMap {
  localTime: number;
  mediaTime: number;
}

const HTML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

export function parseTimestamp(value: string): number | undefined {
  const parts = value.trim().replace(',', '.').split(':');
  if (parts.length < 2 || parts.length > 3) {
    return undefined;
  }

  const seconds = Number(parts.at(-1));
  const minutes = Number(parts.at(-2));
  const hours = parts.length === 3 ? Number(parts[0]) : 0;

  if (![seconds, minutes, hours].every(Number.isFinite)) {
    return undefined;
  }

  return hours * 3600 + minutes * 60 + seconds;
}

export function parseWebVtt(vttText: string): SubtitleCue[] {
  const parsed = parseWebVttRaw(vttText);
  return offsetCues(parsed.cues, standaloneTimestampMapOffset(parsed.timestampMap));
}

function parseWebVttRaw(vttText: string): ParsedWebVtt {
  const lines = vttText.replace(/^\uFEFF/, '').split(/\r?\n/);
  const cues: SubtitleCue[] = [];
  const timestampMap = parseTimestampMap(lines);
  let index = 0;

  while (index < lines.length) {
    let line = lines[index]?.trim() ?? '';
    index += 1;

    if (line === '' || line === 'WEBVTT') {
      continue;
    }

    if (line.startsWith('NOTE') || line === 'STYLE' || line === 'REGION') {
      while (index < lines.length && (lines[index]?.trim() ?? '') !== '') {
        index += 1;
      }
      continue;
    }

    if (!line.includes('-->')) {
      const possibleTiming = lines[index]?.trim() ?? '';
      if (!possibleTiming.includes('-->')) {
        continue;
      }
      line = possibleTiming;
      index += 1;
    }

    const timing = line.match(/^\s*(\S+)\s+-->\s+(\S+)/);
    if (timing === null) {
      continue;
    }

    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    const textLines: string[] = [];

    while (index < lines.length && (lines[index]?.trim() ?? '') !== '') {
      textLines.push(lines[index] ?? '');
      index += 1;
    }

    if (start === undefined || end === undefined || end <= start) {
      continue;
    }

    const text = cleanCueText(textLines.join('\n'));
    if (text !== '') {
      cues.push({ start, end, text });
    }
  }

  return { cues, timestampMap };
}

export function parseSegmentedWebVtt(segments: VttSegmentInput[]): SubtitleCue[] {
  return parseSegmentedWebVttWithTiming(segments).cues;
}

export function parseSegmentedWebVttWithTiming(
  segments: VttSegmentInput[],
  timing: SegmentedWebVttTiming = {},
): SegmentedWebVttParseResult {
  const cues: SubtitleCue[] = [];
  let accumulatedOffset = 0;
  const parsedSegments = segments.map((segment) => ({ segment, parsed: parseWebVttRaw(segment.text) }));
  const nextTiming: SegmentedWebVttTiming = {
    presentationTimeOrigin: timing.presentationTimeOrigin ?? presentationTimeOrigin(segments),
    timestampMapOrigin:
      timing.timestampMapOrigin ?? timestampMapOrigin(parsedSegments.map(({ parsed }) => parsed.timestampMap)),
  };

  for (const [segmentIndex, { segment, parsed }] of parsedSegments.entries()) {
    const segmentCues = parsed.cues;
    const offset = segmentCueOffset(segmentCues, segment, segmentIndex, accumulatedOffset, nextTiming, parsed.timestampMap);

    for (const cue of segmentCues) {
      cues.push({
        start: normalizeCueTime(cue.start + offset),
        end: normalizeCueTime(cue.end + offset),
        text: cue.text,
      });
    }

    accumulatedOffset += segment.duration ?? maxCueEnd(segmentCues);
  }

  return {
    cues: dedupeCues(cues).sort((a, b) => a.start - b.start || a.end - b.end),
    timing: nextTiming,
  };
}

function segmentCueOffset(
  cues: SubtitleCue[],
  segment: VttSegmentInput,
  segmentIndex: number,
  accumulatedOffset: number,
  timing: SegmentedWebVttTiming,
  timestampMap: WebVttTimestampMap | undefined,
): number {
  if (timestampMap !== undefined) {
    if (segment.presentationTime !== undefined) {
      if (segment.mediaTime !== undefined && cuesLookLikeMediaTimeline(cues, segment.duration, segment.mediaTime)) {
        return segment.presentationTime - segment.mediaTime + timestampMap.mediaTime - timestampMap.localTime;
      }

      if (!shouldApplySegmentOffset(cues, segment.duration, segment.presentationTime, segmentIndex)) {
        return 0;
      }

      return segmentOffset(segment, accumulatedOffset, timing.presentationTimeOrigin) - timestampMap.localTime;
    }

    return timestampMap.mediaTime - (timing.timestampMapOrigin ?? 0) - timestampMap.localTime;
  }

  const shouldOffset = shouldApplySegmentOffset(cues, segment.duration, segment.presentationTime, segmentIndex);
  return shouldOffset ? segmentOffset(segment, accumulatedOffset, timing.presentationTimeOrigin) : 0;
}

function cuesLookLikeMediaTimeline(
  cues: SubtitleCue[],
  duration: number | undefined,
  mediaTime: number,
): boolean {
  if (cues.length === 0) {
    return false;
  }

  if (mediaTime <= 1) {
    return true;
  }

  const firstStart = cues[0].start;
  const maxEnd = maxCueEnd(cues);
  const end = duration === undefined ? Number.POSITIVE_INFINITY : mediaTime + duration + 120;

  return firstStart >= mediaTime - 120 && firstStart <= end && maxEnd >= mediaTime - 5;
}

function presentationTimeOrigin(segments: VttSegmentInput[]): number | undefined {
  const first = segments.find((segment) => segment.presentationTime !== undefined)?.presentationTime;
  if (first === undefined) {
    return undefined;
  }

  return first >= 12 * 60 * 60 ? first : undefined;
}

function segmentOffset(segment: VttSegmentInput, accumulatedOffset: number, presentationTimeOrigin: number | undefined): number {
  if (segment.presentationTime === undefined) {
    return accumulatedOffset;
  }

  return segment.presentationTime - (presentationTimeOrigin ?? 0);
}

function shouldApplySegmentOffset(
  cues: SubtitleCue[],
  duration: number | undefined,
  presentationTime: number | undefined,
  segmentIndex: number,
): boolean {
  if (cues.length === 0) {
    return false;
  }

  const firstStart = cues[0].start;
  const maxEnd = maxCueEnd(cues);

  if (presentationTime !== undefined && duration !== undefined) {
    if (cuesLookAbsolute(cues, duration, presentationTime)) {
      return false;
    }
    return maxEnd <= duration + 5;
  }

  if (segmentIndex === 0) {
    return false;
  }

  const segmentWindow = duration ?? maxEnd;
  const relativeStartThreshold = Math.min(1, Math.max(0.25, segmentWindow * 0.25));

  return firstStart <= relativeStartThreshold && maxEnd <= segmentWindow + 2;
}

function cuesLookAbsolute(cues: SubtitleCue[], duration: number | undefined, presentationTime: number): boolean {
  if (cues.length === 0 || duration === undefined) {
    return false;
  }

  const firstStart = cues[0].start;
  const maxEnd = maxCueEnd(cues);
  return firstStart >= presentationTime - 1 && maxEnd <= presentationTime + duration + 5;
}

function parseTimestampMap(lines: string[]): WebVttTimestampMap | undefined {
  const line = lines.find((candidate) => /^X-TIMESTAMP-MAP=/i.test(candidate.trim()));
  if (line === undefined) {
    return undefined;
  }

  const localMatch = line.match(/LOCAL:([^,\s]+)/i);
  const mpegtsMatch = line.match(/MPEGTS:(\d+)/i);
  if (localMatch === null || mpegtsMatch === null) {
    return undefined;
  }

  const localTime = parseTimestamp(localMatch[1]);
  const mpegtsTime = Number(mpegtsMatch[1]) / 90_000;
  if (localTime === undefined || !Number.isFinite(mpegtsTime)) {
    return undefined;
  }

  return { localTime, mediaTime: mpegtsTime };
}

function standaloneTimestampMapOffset(timestampMap: WebVttTimestampMap | undefined): number {
  if (timestampMap === undefined || timestampMap.mediaTime >= 12 * 60 * 60) {
    return 0;
  }

  return timestampMap.mediaTime - timestampMap.localTime;
}

function timestampMapOrigin(timestampMaps: Array<WebVttTimestampMap | undefined>): number | undefined {
  const first = timestampMaps.find((timestampMap): timestampMap is WebVttTimestampMap => timestampMap !== undefined);
  if (first === undefined || first.mediaTime < 12 * 60 * 60) {
    return undefined;
  }

  return first.mediaTime;
}

function offsetCues(cues: SubtitleCue[], offset: number): SubtitleCue[] {
  if (offset === 0) {
    return cues;
  }

  return cues.map((cue) => ({
    ...cue,
    start: normalizeCueTime(cue.start + offset),
    end: normalizeCueTime(cue.end + offset),
  }));
}

function normalizeCueTime(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function maxCueEnd(cues: SubtitleCue[]): number {
  return cues.reduce((max, cue) => Math.max(max, cue.end), 0);
}

function dedupeCues(cues: SubtitleCue[]): SubtitleCue[] {
  const seen = new Set<string>();
  return cues.filter((cue) => {
    const key = `${cue.start.toFixed(3)}:${cue.end.toFixed(3)}:${cue.text}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cleanCueText(text: string): string {
  return decodeHtmlEntities(
    text
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/?[^>]+>/g, '')
      .replace(/[ \t]+\n/g, '\n')
      .trim(),
  ).trim();
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
    const lower = entity.toLowerCase();
    if (lower.startsWith('#x')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
    }
    if (lower.startsWith('#')) {
      return String.fromCodePoint(Number.parseInt(lower.slice(1), 10));
    }
    return HTML_ENTITIES[lower] ?? `&${entity};`;
  });
}
