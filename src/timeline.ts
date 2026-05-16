const MAX_REASONABLE_TIMELINE_OFFSET_SECONDS = 120;
const MIN_REASONABLE_TIMELINE_OFFSET_SECONDS = 0.5;

export function extractMpdMediaPresentationDuration(manifestText: string): number | undefined {
  const match = manifestText.match(/<MPD\b[^>]*\bmediaPresentationDuration\s*=\s*(["'])(.*?)\1/i);
  if (match === null) {
    return undefined;
  }

  return parseIso8601DurationSeconds(match[2]);
}

export function parseIso8601DurationSeconds(value: string): number | undefined {
  const trimmed = value.trim().replace(/,/g, '.');
  const match = trimmed.match(
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i,
  );

  if (match === null) {
    return undefined;
  }

  const [, days, hours, minutes, seconds] = match;
  if ([days, hours, minutes, seconds].every((part) => part === undefined)) {
    return undefined;
  }

  return (
    numericDurationPart(days) * 24 * 60 * 60 +
    numericDurationPart(hours) * 60 * 60 +
    numericDurationPart(minutes) * 60 +
    numericDurationPart(seconds)
  );
}

export function subtitleTimelineOffset(videoDuration: number | undefined, manifestDuration: number | undefined): number {
  if (!finitePositive(videoDuration) || !finitePositive(manifestDuration)) {
    return 0;
  }

  const offset = videoDuration - manifestDuration;
  const absoluteOffset = Math.abs(offset);
  if (
    absoluteOffset < MIN_REASONABLE_TIMELINE_OFFSET_SECONDS ||
    absoluteOffset > MAX_REASONABLE_TIMELINE_OFFSET_SECONDS
  ) {
    return 0;
  }

  return Math.round(offset * 1000) / 1000;
}

function numericDurationPart(value: string | undefined): number {
  return value === undefined ? 0 : Number(value);
}

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
