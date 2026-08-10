import type { NetflixSubtitleCue } from './messages';

interface TtmlTimingParameters {
  tickRate: number;
  frameRate: number;
  nominalFrameRate: number;
}

const DEFAULT_FRAME_RATE = 30;
const LINE_BREAK = '\u0000';
const XML_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
};

/** Parse the text cues in a Netflix IMSC/TTML subtitle document. */
export function parseNetflixTtml(ttmlText: string): NetflixSubtitleCue[] {
  const timing = readTimingParameters(ttmlText);
  const rubyAnnotationStyles = readRubyAnnotationStyles(ttmlText);
  const cues: NetflixSubtitleCue[] = [];
  const source = ttmlText.replace(/<!--[\s\S]*?-->/g, '');
  const paragraphPattern = /<((?:[\w.-]+:)?p)\b([^>]*)>([\s\S]*?)<\/\1\s*>/gi;

  for (const match of source.matchAll(paragraphPattern)) {
    const attributes = parseAttributes(match[2]);
    const startValue = findAttribute(attributes, 'begin');
    const endValue = findAttribute(attributes, 'end');
    const durationValue = findAttribute(attributes, 'dur');
    const start = startValue === undefined ? undefined : parseTimeExpression(startValue, timing);
    const duration = durationValue === undefined ? undefined : parseTimeExpression(durationValue, timing);
    const end = endValue !== undefined
      ? parseTimeExpression(endValue, timing)
      : start !== undefined && duration !== undefined
        ? start + duration
        : undefined;

    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      continue;
    }

    const normalizedStart = normalizeTime(start);
    const normalizedEnd = normalizeTime(end);
    const text = extractCueText(match[3], rubyAnnotationStyles);
    if (normalizedEnd <= normalizedStart || text === '') {
      continue;
    }

    cues.push({ start: normalizedStart, end: normalizedEnd, text });
  }

  return cues.sort((left, right) => left.start - right.start || left.end - right.end);
}

function readTimingParameters(ttmlText: string): TtmlTimingParameters {
  const root = ttmlText.match(/<(?:[\w.-]+:)?tt\b([^>]*)>/i);
  const attributes = parseAttributes(root?.[1] ?? '');
  const frameRateValue = findAttribute(attributes, 'frameRate');
  const tickRateValue = findAttribute(attributes, 'tickRate');
  const rawFrameRate = frameRateValue === undefined
    ? DEFAULT_FRAME_RATE
    : positiveInteger(frameRateValue) ?? Number.NaN;
  const multiplier = parseFrameRateMultiplier(findAttribute(attributes, 'frameRateMultiplier'));
  const frameRate = rawFrameRate * multiplier;

  return {
    tickRate: tickRateValue === undefined ? 1 : positiveInteger(tickRateValue) ?? Number.NaN,
    frameRate,
    nominalFrameRate: rawFrameRate,
  };
}

function parseFrameRateMultiplier(value: string | undefined): number {
  if (value === undefined) {
    return 1;
  }

  const match = value.trim().match(/^(\d+)\s+(\d+)$/);
  if (match === null) {
    return Number.NaN;
  }

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);
  return numerator > 0 && denominator > 0 ? numerator / denominator : Number.NaN;
}

function positiveInteger(value: string): number | undefined {
  if (!/^\d+$/.test(value.trim())) {
    return undefined;
  }

  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function parseTimeExpression(value: string, timing: TtmlTimingParameters): number | undefined {
  const expression = value.trim();
  const clock = expression.match(/^(\d{2,}):([0-5]\d):([0-5]\d(?:\.\d+)?)$/);
  if (clock !== null) {
    return clockTime(Number(clock[1]), Number(clock[2]), Number(clock[3]));
  }

  const frameClock = expression.match(/^(\d{2,}):([0-5]\d):([0-5]\d):(\d+)(?:\.(\d+))?$/);
  if (frameClock !== null) {
    const frames = Number(frameClock[4]);
    const subframes = frameClock[5] === undefined ? 0 : Number(`0.${frameClock[5]}`);
    if (
      !Number.isFinite(timing.frameRate) ||
      frames >= timing.nominalFrameRate ||
      ![frames, subframes].every(Number.isFinite)
    ) {
      return undefined;
    }

    const wholeSeconds = clockTime(Number(frameClock[1]), Number(frameClock[2]), Number(frameClock[3]));
    return wholeSeconds === undefined ? undefined : wholeSeconds + (frames + subframes) / timing.frameRate;
  }

  const offset = expression.match(/^(\d+(?:\.\d+)?)(h|ms|m|s|f|t)$/i);
  if (offset === null) {
    return undefined;
  }

  const amount = Number(offset[1]);
  if (!Number.isFinite(amount)) {
    return undefined;
  }

  switch (offset[2].toLowerCase()) {
    case 'h':
      return amount * 3600;
    case 'm':
      return amount * 60;
    case 's':
      return amount;
    case 'ms':
      return amount / 1000;
    case 'f':
      return Number.isFinite(timing.frameRate) ? amount / timing.frameRate : undefined;
    case 't':
      return Number.isFinite(timing.tickRate) ? amount / timing.tickRate : undefined;
  }
}

interface TtmlStyle {
  references: string[];
  ruby?: string;
}

function readRubyAnnotationStyles(ttmlText: string): Set<string> {
  const styles = new Map<string, TtmlStyle>();
  const stylePattern = /<(?:[\w.-]+:)?style\b([^>]*)\/?\s*>/gi;

  for (const match of ttmlText.matchAll(stylePattern)) {
    const attributes = parseAttributes(match[1]);
    const id = findAttribute(attributes, 'id');
    if (id === undefined || id.trim() === '') {
      continue;
    }
    styles.set(id, {
      references: (findAttribute(attributes, 'style') ?? '').trim().split(/\s+/).filter(Boolean),
      ruby: findAttribute(attributes, 'ruby')?.toLowerCase(),
    });
  }

  const annotations = new Set<string>();
  const resolved = new Map<string, boolean>();
  const resolving = new Set<string>();
  const isAnnotation = (id: string): boolean => {
    const known = resolved.get(id);
    if (known !== undefined) {
      return known;
    }
    if (resolving.has(id)) {
      return false;
    }

    const style = styles.get(id);
    if (style === undefined) {
      return false;
    }
    resolving.add(id);
    const result = style.ruby === undefined
      ? style.references.some(isAnnotation)
      : isRubyAnnotationValue(style.ruby);
    resolving.delete(id);
    resolved.set(id, result);
    return result;
  };

  for (const id of styles.keys()) {
    if (isAnnotation(id)) {
      annotations.add(id);
    }
  }
  return annotations;
}

function clockTime(hours: number, minutes: number, seconds: number): number | undefined {
  if (![hours, minutes, seconds].every(Number.isFinite)) {
    return undefined;
  }
  return hours * 3600 + minutes * 60 + seconds;
}

function parseAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attributePattern = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

  for (const match of source.matchAll(attributePattern)) {
    attributes.set(match[1].toLowerCase(), decodeXmlEntities(match[2] ?? match[3] ?? ''));
  }
  return attributes;
}

function findAttribute(attributes: Map<string, string>, localName: string): string | undefined {
  const expectedName = localName.toLowerCase();
  for (const [name, value] of attributes) {
    if (name.split(':').at(-1) === expectedName) {
      return value;
    }
  }
  return undefined;
}

interface OpenElement {
  excluded: boolean;
  name: string;
}

function extractCueText(markup: string, rubyAnnotationStyles: Set<string>): string {
  const parts: string[] = [];
  const stack: OpenElement[] = [];
  let excludedDepth = 0;
  const tokenPattern = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--([\s\S]*?)-->|<[^>]+>|[^<]+/g;

  for (const match of markup.matchAll(tokenPattern)) {
    const token = match[0];
    if (token.startsWith('<!--')) {
      continue;
    }
    if (token.startsWith('<![CDATA[')) {
      if (excludedDepth === 0) {
        parts.push(match[1] ?? '');
      }
      continue;
    }
    if (!token.startsWith('<')) {
      if (excludedDepth === 0) {
        parts.push(decodeXmlEntities(token));
      }
      continue;
    }

    const closing = token.match(/^<\s*\/\s*([^\s>]+)/);
    if (closing !== null) {
      closeElement(stack, localName(closing[1]), () => {
        excludedDepth -= 1;
      });
      continue;
    }

    const opening = token.match(/^<\s*([^!?\s/>]+)/);
    if (opening === null) {
      continue;
    }

    const name = localName(opening[1]);
    const selfClosing = /\/\s*>$/.test(token);
    if (name === 'br' && excludedDepth === 0) {
      parts.push(LINE_BREAK);
    }

    const excluded = isRubyAnnotation(name, parseAttributes(token), rubyAnnotationStyles);
    if (!selfClosing) {
      stack.push({ excluded, name });
      if (excluded) {
        excludedDepth += 1;
      }
    }
  }

  return parts
    .join('')
    .split(LINE_BREAK)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .join('\n')
    .trim();
}

function closeElement(stack: OpenElement[], name: string, onExcluded: () => void): void {
  for (let index = stack.length - 1; index >= 0; index -= 1) {
    const element = stack.pop();
    if (element?.excluded === true) {
      onExcluded();
    }
    if (element?.name === name) {
      return;
    }
  }
}

function isRubyAnnotation(
  name: string,
  attributes: Map<string, string>,
  rubyAnnotationStyles: Set<string>,
): boolean {
  if (name === 'rt' || name === 'rp') {
    return true;
  }

  const ruby = findAttribute(attributes, 'ruby')?.toLowerCase();
  if (ruby !== undefined) {
    return isRubyAnnotationValue(ruby);
  }

  return (findAttribute(attributes, 'style') ?? '')
    .trim()
    .split(/\s+/)
    .some((id) => rubyAnnotationStyles.has(id));
}

function isRubyAnnotationValue(value: string): boolean {
  return value === 'text' || value === 'textcontainer' || value === 'delimiter';
}

function localName(qualifiedName: string): string {
  return qualifiedName.split(':').at(-1)?.toLowerCase() ?? qualifiedName.toLowerCase();
}

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][\w.-]*);/gi, (encoded, entity: string) => {
    const normalized = entity.toLowerCase();
    if (!normalized.startsWith('#')) {
      return XML_ENTITIES[normalized] ?? encoded;
    }

    const codePoint = normalized.startsWith('#x')
      ? Number.parseInt(normalized.slice(2), 16)
      : Number.parseInt(normalized.slice(1), 10);
    if (
      !Number.isInteger(codePoint) ||
      codePoint < 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return encoded;
    }
    return String.fromCodePoint(codePoint);
  });
}

function normalizeTime(value: number): number {
  const milliseconds = value * 1000;
  const roundingTolerance = Number.EPSILON * Math.max(1, Math.abs(milliseconds)) * 2;
  return Math.round(milliseconds + roundingTolerance) / 1000;
}
